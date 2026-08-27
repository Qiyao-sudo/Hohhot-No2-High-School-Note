#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sync_doc.py — 从腾讯文档抓取《呼市二中学习生活指导》并生成 VitePress Markdown 页面。

用法:
    python scripts/sync_doc.py            # 抓取并生成 docs/ 下所有页面(含图片下载)
    python scripts/sync_doc.py --dry-run  # 仅打印解析结果, 不写文件
    python scripts/sync_doc.py --no-img   # 跳过图片下载, 只同步文本

腾讯文档没有公开的导出 API, 本脚本解析其内部 dop-api 返回的 protobuf 正文:
- 文本块: field6 内嵌 field1(全文文本, \\r 为换行, \\x08 为格式标记)
- 图片:   含 docimg URL 的记录, field2/field3 为图片锚点在文本中的字符位置
若接口变动导致解析失败, 请手动从腾讯文档导出并替换 docs/ 内容。
"""

import base64
import hashlib
import re
import sys
import urllib.request
from pathlib import Path

DOC_ID = "DYm5PeUxOVmdEZmxs"
API = (
    "https://docs.qq.com/dop-api/opendoc"
    "?u=&id=%s&normal=1&outformat=1&noEscape=1"
    "&commandsFormat=1&doc_chunk_version=3&preview_token=&doc_chunk_flag=1" % DOC_ID
)

ROOT = Path(__file__).resolve().parent.parent
DOCS_DIR = ROOT / "docs"
IMG_DIR = DOCS_DIR / "public" / "images"
MESSAGES_JSON = ROOT / "docs" / ".vitepress" / "theme" / "doc-messages.json"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    ),
    "Referer": "https://docs.qq.com/doc/" + DOC_ID,
}

# 各板块标题(正文中逐字出现), 按文档顺序生成页面
SECTIONS = [
    {"file": "freshman.md", "title": "新生须知", "headings": ["新生须知"]},
    {"file": "daily.md", "title": "日常生活", "headings": ["日常生活"]},
    {"file": "faq.md", "title": "常见问题汇总", "headings": ["关于一些常见的问题汇总"]},
    {"file": "tradition.md", "title": "二中传统", "headings": ["二中传统", "关于二中传统"]},
    {"file": "study.md", "title": "学习板块", "headings": ["学习板块"]},
    {"file": "messages.md", "title": "留言处", "headings": ["留言处"], "comment": True},
    {"file": "afterword.md", "title": "后记", "headings": ["后记"]},
]

JUNK_RES = [
    re.compile(r"^(Arial|微软雅黑|宋体|黑体|Calibri|Times New Roman)$"),
    re.compile(r"^[0-9A-F]{6}$"),
    re.compile(r"^(en-US|zh-CN|ar-SA)$"),
    re.compile(r"^\s*(4@|n@)\s*$"),
    re.compile(r"^p\.\d"),
    re.compile(r"^STHexColor"),
    re.compile(r"^\d+@?$"),
    re.compile(r"^[0-9A-Fa-f@:.]{5,}$"),  # 十六进制色值/坐标/句柄
    re.compile(r"^[A-Za-z]@?$"),          # 单字母句柄
    re.compile(r"^(auto|pictureZ?|ISO-8859-1)$", re.I),
    re.compile(r"^!?[A-Za-z][A-Za-z0-9]{5,}$"),  # Word settings.xml 驼峰标识符
]

CTRL = "".join(chr(c) for c in list(range(0, 9)) + [0x0B, 0x0C] + list(range(0x0E, 0x20)))


# ---------------------------------------------------------------- protobuf 解析

def read_varint(buf, i):
    value, shift = 0, 0
    while True:
        b = buf[i]
        i += 1
        value |= (b & 0x7F) << shift
        if b < 0x80:
            return value, i
        shift += 7


def parse_fields(buf):
    """扁平解析 protobuf 字段: 返回 [(field_no, bytes|varint), ...]"""
    i, out = 0, []
    while i < len(buf):
        try:
            tag, j = read_varint(buf, i)
        except IndexError:
            break
        fn, wt = tag >> 3, tag & 7
        try:
            if wt == 2:
                L, k = read_varint(buf, j)
                if L > len(buf) - k:
                    break
                out.append((fn, buf[k:k + L]))
                i = k + L
            elif wt == 0:
                v, i = read_varint(buf, j)
                out.append((fn, v))
            elif wt == 5:
                i = j + 4
            elif wt == 1:
                i = j + 8
            else:
                break
        except IndexError:
            break
    return out


def extract_doc(payload):
    """返回 (全文文本, [(锚点字符位置, 图片URL), ...], [样式段, ...])

    样式段 = (起始, 结束, {"bold": bool, "color": hex, "mark": hex})
    - 文字颜色: f201 载荷中 field37/field53, 形如 "\\x0a\\x08\\x0a\\x06<6hex>"
    - 高亮背景: field59 中 "\\x5a\\x08\\x0a\\x06<6hex>"
    - 加粗: field59 "\\xda\\x03..\\x08\\x02" 或 field3 "\\x1a\\x02\\x08\\x02"
    """
    b64 = payload["clientVars"]["collab_client_vars"]["initialAttributedText"]["text"][0]
    raw = base64.b64decode(b64 + "=" * (-len(b64) % 4))
    records = [v for f, v in parse_fields(parse_fields(raw)[0][1])
               if f == 2 and isinstance(v, bytes)]
    text, images, styles = None, [], []
    for r in records:
        if b"docimg" in r:
            d = {}
            for f, v in parse_fields(r):
                d.setdefault(f, v)
            # field2 = "\x08" + varint(锚点位置)
            pos, _ = read_varint(d[2], 1)
            m = re.search(rb"https://docimg[^\x00\x1a\x22*]+", d[7])
            if m:
                images.append((pos, m.group().decode(errors="ignore").rstrip("*")))
            continue
        if text is None:
            for f, v in parse_fields(r):
                if f == 6 and len(v) > 1000:
                    sub = parse_fields(v)
                    if sub and isinstance(sub[0][1], bytes):
                        try:
                            text = sub[0][1].decode("utf-8")
                            break
                        except UnicodeDecodeError:
                            pass
        # 样式记录: field2/field3 = 覆盖区间
        d = {}
        for f, v in parse_fields(r):
            d.setdefault(f, v)
        f2, f3, f7 = d.get(2), d.get(3), d.get(7)
        if not (isinstance(f2, bytes) and isinstance(f3, bytes)
                and isinstance(f7, bytes) and len(f2) > 1 and len(f3) > 1):
            continue
        s0, _ = read_varint(f2, 1)
        e0, _ = read_varint(f3, 1)
        if s0 is None or e0 is None or e0 <= s0 or e0 - s0 > 200:
            continue
        attr = {}
        if re.search(rb"\xda\x03.\x08\x02", f7, re.S) or b"\x1a\x02\x08\x02" in f7:
            attr["bold"] = True
        cm = re.search(rb"\x5a\x08\x0a\x06([0-9A-Fa-f]{6})", f7)
        if cm:
            attr["mark"] = cm.group(1).decode()
        tm = re.search(rb"(?:\xaa\x02\x0a\x0a|\xea\x02\x0a)\x08\x0a\x06([0-9A-Fa-f]{6})", f7)
        if tm:
            attr["color"] = tm.group(1).decode()
        if attr:
            styles.append((s0, e0, attr))
    return text, images, styles


# ---------------------------------------------------------------- 图片下载

def sanitize_url(url):
    # 部分记录的 URL 尾部混入 protobuf 控制字符, 截掉
    return re.split(r"[\x00-\x20]", url)[0]


MAX_WIDTH = 1000  # 本地压缩: 宽度上限(px)


def compress_image(path):
    """有 Pillow 时把图片压到 MAX_WIDTH 宽/质量 82, 减小仓库体积"""
    try:
        from PIL import Image
    except ImportError:
        return
    try:
        with Image.open(path) as im:
            im = im.convert("RGB") if im.mode not in ("RGB", "L") else im
            if im.width > MAX_WIDTH:
                im = im.resize((MAX_WIDTH, round(im.height * MAX_WIDTH / im.width)))
            im.save(path, "JPEG", quality=82)
    except Exception:
        pass


def download_images(images):
    """下载图片到 docs/public/images/, 返回 {url: 本地文件名}"""
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    mapping = {}
    for pos, url in images:
        url = sanitize_url(url)
        ext = Path(url.split("?")[0]).suffix or ".jpg"
        name = hashlib.md5(url.encode()).hexdigest()[:16] + ".jpg"
        mapping[url] = name
        dest = IMG_DIR / name
        if dest.exists() and dest.stat().st_size > 0:
            continue
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=60) as resp:
                dest.write_bytes(resp.read())
            compress_image(dest)
            print(f"  ↓ {name} ({dest.stat().st_size // 1024} KB)")
        except Exception as exc:
            print(f"  ✗ 下载失败 {url[:60]}: {exc}")
            dest.unlink(missing_ok=True)
            mapping.pop(url)
    return mapping


# ---------------------------------------------------------------- 文本处理

def is_junk(s):
    s = s.strip()
    if not s or set(s) <= {"\x08", " ", "\u3000"}:
        return True
    cleaned = s.translate({ord(c): None for c in CTRL}).strip()
    if not cleaned:
        return True
    if any(rx.search(cleaned) for rx in JUNK_RES):
        return True
    if not re.search(r"[\u4e00-\u9fa5A-Za-z0-9]", cleaned):
        return True
    if cleaned in ("picture", "descript", "descript:") or cleaned.startswith("http://schemas"):
        return True
    return False


def decode_tdfn(s):
    r"""链接名形如 %u00E5%u0091%u00BC… —— 是 UTF-8 字节的逐字节转义,
    连续的 %uXXXX 需先还原为字节序列再按 UTF-8 解码。"""
    def repl(m):
        try:
            raw = bytes(int(h, 16)
                        for h in re.findall(r"%u([0-9A-Fa-f]{4})", m.group(0)))
            return raw.decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            return m.group(0)
    return re.sub(r"(?:%u[0-9A-Fa-f]{4})+", repl, s)


def para_to_markdown(s):
    """单行文本转 Markdown(处理附件与超链接)。"""
    s = s.translate({ord(c): None for c in CTRL}).strip()
    if not s:
        return None
    if "ATTACHMENT" in s:
        name_m = re.search(r"\\f\s+(\S.*?)\s+\\s", s)
        name = name_m.group(1) if name_m else "附件"
        clean = re.sub(r"ATTACHMENT.*", "", s).strip()
        line = f"> 📎 *源文档附件：{name}（请见[原文档](https://docs.qq.com/doc/{DOC_ID})）*"
        return (line + "\n\n" + clean) if clean else line
    if "HYPERLINK" in s:
        m = re.search(r"HYPERLINK\s+(\S+)", s)
        if m:
            name_m = re.search(r"\\tdfn\s+(.*?)\s+\\tdfu", s)
            name = decode_tdfn(name_m.group(1)) if name_m else m.group(1)
            clean = re.sub(r"HYPERLINK.*", "", s).strip()
            link = f"[{name}]({m.group(1)})"
            return (link + "\n\n" + clean) if clean else link
    return s


DEFAULT_COLORS = {"000000", "333333"}  # 及 0000xx 自动色
BOLD_RE = re.compile(rb"\xda\x03.\x08\x02", re.S)
MARK_RE = re.compile(rb"\x5a\x08\x0a\x06([0-9A-Fa-f]{6})")
COLOR_RE = re.compile(rb"(?:\xaa\x02\x0a\x0a|\xea\x02\x0a)\x08\x0a\x06([0-9A-Fa-f]{6})")


def plain_text(line):
    """去掉行内 Markdown/HTML 样式, 得到纯文本(用于板块标题匹配)"""
    t = re.sub(r"</?(?:span|mark|strong|em)[^>]*>|</?mark[^>]*>", "", line)
    t = t.replace("**", "")
    import html as _h
    return _h.unescape(t).strip()


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def render_line(seg_text, base, style_at):
    """按字符样式渲染一行为 HTML/Markdown 混合文本"""
    runs = []
    cur_style, buf = None, []
    for k, ch in enumerate(seg_text):
        st = style_at(base + k)
        if st != cur_style:
            if buf:
                runs.append((cur_style, "".join(buf)))
            cur_style, buf = st, [ch]
        else:
            buf.append(ch)
    if buf:
        runs.append((cur_style, "".join(buf)))
    parts = []
    for st, chunk in runs:
        if not chunk:
            continue
        t = esc(chunk)
        color, mark, bold = st
        if color:
            t = f'<span style="color:#{color}">{t}</span>'
        if mark:
            t = f"<mark>{t}</mark>"
        if bold:
            t = f"**{t}**"
        parts.append(t)
    return "".join(parts)


def line_style_stats(s, e, style_at):
    """行内可见字符的样式覆盖率: (bold_ratio, colored_ratio)"""
    n = b = c = 0
    for i in range(s, e):
        st = style_at(i)
        n += 1
        b += 1 if st[2] else 0
        c += 1 if st[0] else 0
    if not n:
        return 0.0, 0.0
    return b / n, c / n


HEADING_EXCLUDE = re.compile(r"^[-*•·—]")
PARTICLE_END = ("哈", "哦", "吧", "呢", "啊", "呀", "啦", "嘛")
# 含这些标点的行视为内容而非标题(Q&A/序号条目除外, 它们先行判定)
CONTENT_PUNCT = "，。：；？！、~@—:"


def heading_level(line, bold_ratio, colored_ratio):
    """推断标题层级(2/3/4), 非标题返回 None。

    原文档未使用 Word 标题样式, 层级由文本模式 + 加粗/着色推断:
    - 二级: "关于X" / "X景区" 小节
    - 三级: 01/02 步骤、Q&A 问题、简短加粗/着色行、固定小标题
    - 四级: 中文序号条目(学习方法"一、二、…"等)
    """
    s = line.strip()
    if len(s) < 2 or len(s) > 60 or HEADING_EXCLUDE.match(s):
        return None
    # Q&A 问题与数字步骤先判定(可能以 ？/。 结尾)
    if re.match(r"^Q\d+[:：]", s) and len(s) <= 30:
        return 3
    if re.match(r"^0\d(\s|\s*$)", s):
        return 3
    if re.match(r"^[一二三四五六七八九十]+、", s):
        return 4
    # 内容性行: 含标点/日期/时间段
    if any(c in s for c in CONTENT_PUNCT):
        return None
    if s.endswith(PARTICLE_END) or re.search(r"\d+月\d+日|\d+:\d+", s):
        return None
    fully_bold = bold_ratio >= 0.8
    fully_colored = colored_ratio >= 0.8
    # 二级: 关于X / X景区
    if re.fullmatch(r"(关于|呼伦景区|如意景区|金川景区|二中传统).{0,14}", s):
        return 2
    # 三级: 校区小节 / 固定小标题 / 整行加粗或着色的短行
    if s in ("呼伦", "如意", "金川", "呼伦/如意"):
        return 3
    if s in KNOWN_SUBHEADINGS:
        return 3
    if len(s) <= 16 and (fully_bold or fully_colored):
        return 3
    return None


# 源文档中出现过的小标题用词(同步时按需补充)
KNOWN_SUBHEADINGS = {
    "菜单", "宿舍相关", "自习室相关", "作息时间表", "教材", "通用学习方法",
    "学科学习方法", "夜自习管理", "间操", "活动课", "夜自习", "航拍影像及图书楼影像",
    "更多Q&A", "欢迎补充", "高一", "高二", "高三", "恋爱相关", "头发相关",
}


def build_lines(text, images, url_map, styles):
    """把全文文本按 \\r 拆行, 在图片锚点处插入图片, 应用行内样式并识别标题层级。
    返回 [(line, level)] — level 为 0 表示正文。"""
    imgs = sorted(
        [(pos, url) for pos, url in images if url in url_map], key=lambda t: t[0])

    # 按字符位置建立样式索引
    def style_at(i):
        color = mark = bold = None
        for s0, e0, attr in styles:
            if s0 <= i < e0:
                c = attr.get("color")
                if c and c.upper() not in DEFAULT_COLORS and not c.upper().startswith("0000"):
                    color = c.lower()
                if attr.get("mark"):
                    mark = True
                if attr.get("bold"):
                    bold = True
        return (color, mark, bold)

    lines = []  # (start, end) 每 \r 一行
    start = 0
    for i, ch in enumerate(text):
        if ch == "\r":
            lines.append((start, i))
            start = i + 1
    lines.append((start, len(text)))

    out = []
    for li, (s, e) in enumerate(lines):
        # 该行前的图片锚点
        for pos, url in imgs:
            if s <= pos < e or (li + 1 < len(lines) and pos == e):
                out.append((f"![](/images/{url_map[url]})", 0))
        seg = text[s:e]
        visible = [k for k, ch in enumerate(seg)
                   if ch.isprintable() and ch not in "\x08\x0c"]
        if not visible:
            continue
        plain = "".join(seg[k] for k in visible).strip()
        if is_junk(plain):
            continue
        bold_n = color_n = 0
        for k in visible:
            st = style_at(s + k)
            bold_n += 1 if st[2] else 0
            color_n += 1 if st[0] else 0
        bold_ratio = bold_n / len(visible)
        color_ratio = color_n / len(visible)
        lvl = heading_level(plain, bold_ratio, color_ratio)
        if lvl:
            out.append((plain, lvl))
        else:
            rendered = render_line(seg, s, style_at)
            rendered = rendered.strip()
            if rendered and not is_junk(re.sub(r"<[^>]+>", "", rendered)):
                out.append((rendered, 0))
    # "加粗标签 + 配图"的设施清单: 标题后紧跟图片则降为四级(图注性质)
    campus = {"呼伦", "如意", "金川", "呼伦/如意"}
    for i, (ln, lvl) in enumerate(out):
        if (lvl == 3 and ln not in campus
                and i + 1 < len(out) and out[i + 1][0].startswith("![]")):
            out[i] = (ln, 4)
    return out


# ---------------------------------------------------------------- 主流程

def fetch_json():
    req = urllib.request.Request(API, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json_loads(resp.read().decode("utf-8"))


def json_loads(s):
    import json
    return json.loads(s)


def main():
    dry = "--dry-run" in sys.argv
    payload = fetch_json()
    text, images, styles = extract_doc(payload)
    if not text:
        print("✗ 未能解析文档正文")
        sys.exit(1)
    print(f"正文 {len(text)} 字符, {len(images)} 张图片, {len(styles)} 条样式记录")

    if dry:
        for pos, url in sorted(images)[:5]:
            print(f"  img@{pos} {url[:70]}")
        return

    if "--no-img" in sys.argv:
        url_map = {}
        paras = build_lines(text, [], {}, styles)
    else:
        print("下载图片…")
        url_map = download_images(images)
        paras = build_lines(text, images, url_map, styles)
        print(f"图片下载完成: {len(url_map)} 张")
    print(f"解析到 {len(paras)} 个有效段落")

    # 文档尾部是导入 Word 时残留的样式表/设置 XML(纯 ASCII)。
    # 找到连续 12 行不含中文的位置, 视为正文结束。
    for i in range(len(paras) - 12):
        if all(not re.search(r"[\u4e00-\u9fff]", p) for p, _ in paras[i:i + 12]):
            print(f"正文结束于第 {i} 段(其后为导入残留, 共略去 {len(paras) - i} 段)")
            paras = paras[:i]
            break

    bounds = []
    for sec in SECTIONS:
        start = next((i for i, (p, _) in enumerate(paras)
                      if plain_text(p) in sec["headings"]), None)
        if start is None:
            print(f"⚠ 未找到板块标题: {sec['title']}")
            continue
        bounds.append((start, sec))
    bounds.sort(key=lambda t: t[0])
    for k, (start, sec) in enumerate(bounds):
        end = bounds[k + 1][0] if k + 1 < len(bounds) else len(paras)
        sec["body"] = paras[start + 1:end]

    DOCS_DIR.mkdir(parents=True, exist_ok=True)

    for _, sec in bounds:
        fm = "---\ntitle: %s\n" % sec["title"]
        if sec.get("comment"):
            fm += "comment: true\n"
        fm += "---\n\n"
        lines = [
            fm + "# %s\n\n" % sec["title"]
            + "> 本页面由[源文档](https://docs.qq.com/doc/%s)自动同步生成，"
              "如内容有出入请以源文档为准。\n\n" % DOC_ID
        ]
        for p, lvl in sec["body"]:
            if p.startswith("![]"):
                lines.append(p + "\n")
                continue
            if lvl >= 2:
                lines.append(f"\n{'#' * lvl} {p}\n")
                continue
            md = para_to_markdown(p)
            if md:
                lines.append(md + "\n")
        if sec.get("comment"):
            lines.append(
                "\n---\n\n## 网站留言区\n\n"
                "上方为[源文档留言处](https://docs.qq.com/doc/"
                + DOC_ID + ")的同步内容，下方为本站评论区。"
                "网站留言会定期由维护者整理回源文档留言区。\n"
            )
        (DOCS_DIR / sec["file"]).write_text("\n".join(lines), encoding="utf-8")
        print(f"✓ docs/{sec['file']} ({len(sec['body'])} 段)")

    # 留言处导出为 JSON, 供前端与 Waline 评论并排展示
    msg_sec = next((s for _, s in bounds if s["title"] == "留言处"), None)
    if msg_sec:
        messages = [p for p, _ in msg_sec["body"]
                    if len(p) > 1 and not p.startswith("![")]
        MESSAGES_JSON.parent.mkdir(parents=True, exist_ok=True)
        MESSAGES_JSON.write_text(
            json_dumps({"source": "docs.qq.com/doc/" + DOC_ID, "messages": messages}),
            encoding="utf-8")
        print(f"✓ {MESSAGES_JSON.relative_to(ROOT)} ({len(messages)} 条留言)")


def json_dumps(obj):
    import json
    return json.dumps(obj, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
