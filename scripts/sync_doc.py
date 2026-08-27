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

# 板块(源文档大纲的二级标题)→ 页面文件的映射。
# 大纲层级来自 scripts/outline.json(由腾讯文档 /p/ 发布页的大纲面板提取,
# 条目 class 为 headline-title/headingtwo/headingthree/headingother)。
PAGES = [
    {"file": "freshman.md", "title": "新生须知"},
    {"file": "daily.md", "title": "日常生活"},
    {"file": "student-org.md", "title": "学生会 国旗班 播音站相关"},
    {"file": "clubs.md", "title": "社团相关"},
    {"file": "study-policy.md", "title": "日常学习政策及环境"},
    {"file": "management.md", "title": "日常管理"},
    {"file": "jinchuan.md", "title": "金川校区情况"},
    {"file": "tradition.md", "title": "二中传统"},
    {"file": "study.md", "title": "学习板块"},
    {"file": "messages.md", "title": "留言处", "comment": True},
    {"file": "afterword.md", "title": "后记"},
]

# 过小的板块并入前一页(避免单行页面)
MERGE_INTO_PREV = {"更多Q&A": "messages.md"}

# 浮动文本框重定位: 源文档中的"高亮框"是浮动对象, 在文本流中位于文档末尾,
# 实际显示在锚点行下方。规则: (浮动行开头文本, 锚点行包含文本)。
FLOATING_RULES = [
    ("根据学生反应", "校服订购指南"),
]

OUTLINE_FILE = Path(__file__).resolve().parent / "outline.json"


def load_outline():
    """读取大纲: 返回 {标题文本: 层级} 与 H2 板块顺序"""
    data = json_loads(OUTLINE_FILE.read_text(encoding="utf-8"))
    level_map, h2_order = {}, []
    for item in data:
        cls = item.get("cls", "")
        text = item.get("text", "").strip()
        if not text:
            continue
        if "headline-title" in cls:
            lvl = 1
        elif "headline-headingother" in cls:  # 更深层级(注意先于通用匹配)
            lvl = 4
        elif "headline-headingtwo" in cls:
            lvl = 2
        elif "headline-headingthree" in cls:
            lvl = 3
        elif "headline-heading" in cls:  # headingone 等
            lvl = 2
        else:
            lvl = 4
        # 同名条目保留更高层级
        if text not in level_map or lvl < level_map[text]:
            level_map[text] = lvl
        if lvl == 2 and text not in h2_order:
            h2_order.append(text)
    return level_map, h2_order


def json_loads(s):
    import json
    return json.loads(s)

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
    """转义正文字面字符: HTML 实体 + Markdown 强调符(避免破坏 ** 加粗结构)"""
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace("*", "&#42;").replace("_", "&#95;"))


def render_line(seg_text, base, style_at):
    """按字符样式渲染一行为 HTML/Markdown 混合文本(跳过不可见控制字符)"""
    runs = []
    cur_style, buf = None, []
    for k, ch in enumerate(seg_text):
        if not (ch.isprintable() and ch not in "\x08\x0c"):
            continue
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
        if not chunk.strip():
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


HEADING_EXCLUDE = re.compile(r"^[-*•·—]")


def heading_level(line, level_map):
    """标题层级以大纲(scripts/outline.json)为准;
    大纲未覆盖的新增行按可靠文本模式兜底。返回 0 表示正文。"""
    s = line.strip()
    if len(s) < 2 or len(s) > 60 or HEADING_EXCLUDE.match(s):
        return 0
    if s in level_map:
        return level_map[s]
    # 兜底: 大纲未收录的新标题(源文档更新后)
    if re.fullmatch(r"关于.{1,14}", s):
        return 4
    if re.match(r"^Q\d+[:：]", s) and len(s) <= 30:
        return 4
    if re.match(r"^[一二三四五六七八九十]+、", s):
        return 4
    return 0


def build_lines(text, images, url_map, styles, level_map):
    """把全文文本按 \\r 拆行, 在图片锚点处插入图片, 应用行内样式并识别标题层级。
    返回 [(line, level)] — level 为 0 表示正文, 1 为文档标题。"""
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
    floating = []
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
        # 浮动文本框(\x0f 开头): 暂存, 按规则重定位到锚点行之后
        if "\x0f" in seg:
            rendered = render_line(seg, s, style_at).strip()
            floating.append((plain, rendered))
            continue
        lvl = heading_level(plain, level_map)
        if lvl and lvl <= 1:
            continue  # 文档主标题不进正文
        if "ATTACHMENT" in plain or "HYPERLINK" in plain:
            # 附件/链接占位行: 纯文本转换(避免内联标签被截断产生未闭合 HTML)
            md = para_to_markdown(plain)
            if md:
                out.append((md, 0))
            continue
        if lvl:
            out.append((plain, lvl))
        else:
            rendered = render_line(seg, s, style_at)
            rendered = rendered.strip()
            if rendered and not is_junk(re.sub(r"<[^>]+>", "", rendered)):
                out.append((rendered, 0))

    # 浮动文本框重定位: 插入到锚点行(最后一个匹配行)之后, 渲染为高亮提示
    for plain, rendered in floating:
        rule = next((r for r in FLOATING_RULES if plain.startswith(r[0])), None)
        # <mark> 内的 Markdown 强调不会被解析, 转为 HTML <strong>
        rendered = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", rendered)
        box = f"> <mark>{rendered}</mark>"
        if rule is None:
            out.append((box, 0))
            continue
        anchor_idx = [i for i, (ln, _) in enumerate(out) if rule[1] in ln]
        if anchor_idx:
            out.insert(anchor_idx[-1] + 1, (box, 0))
        else:
            out.append((box, 0))
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
    level_map, h2_order = load_outline()
    print(f"大纲: {len(level_map)} 条, {len(h2_order)} 个板块")
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
        paras = build_lines(text, [], {}, styles, level_map)
    else:
        print("下载图片…")
        url_map = download_images(images)
        paras = build_lines(text, images, url_map, styles, level_map)
        print(f"图片下载完成: {len(url_map)} 张")
    print(f"解析到 {len(paras)} 个有效段落")

    # 文档尾部是导入 Word 时残留的样式表/设置 XML(纯 ASCII)。
    # 找到连续 12 行不含中文的位置, 视为正文结束。
    for i in range(len(paras) - 12):
        if all(not re.search(r"[\u4e00-\u9fff]", p) for p, _ in paras[i:i + 12]):
            print(f"正文结束于第 {i} 段(其后为导入残留, 共略去 {len(paras) - i} 段)")
            paras = paras[:i]
            break

    # 按大纲 H2 板块切分页面; 第一个 H2 之前为文档引言(写入 index.md)
    page_of = {p["title"]: p for p in PAGES}
    sections = []  # (page_title, [(line, level)]), page_title=None 表示引言
    current_title = None
    current = []
    for line, lvl in paras:
        plain = plain_text(line)
        if plain in MERGE_INTO_PREV:
            # 小板块不单独成页, 作为子标题并入当前页
            current.append((plain, 3))
            continue
        if plain in h2_order and lvl == 2:
            if current or current_title:
                sections.append((current_title, current))
            current_title = plain
            current = []
            continue
        current.append((line, lvl))
    sections.append((current_title, current))

    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    preamble = None
    written = []
    for title, body in sections:
        if title is None:
            preamble = body
            continue
        page = page_of.get(title)
        if page is None:
            print(f"⚠ 大纲板块未配置页面文件, 跳过: {title}")
            continue
        fm = "---\ntitle: %s\n" % title
        if page.get("comment"):
            fm += "comment: true\n"
        fm += "---\n\n"
        lines = [
            fm + "# %s\n\n" % title
            + "> 本页面由[源文档](https://docs.qq.com/doc/%s)自动同步生成，"
              "如内容有出入请以源文档为准。\n\n" % DOC_ID
        ]
        for p, lvl in body:
            if p.startswith("![]"):
                lines.append(p + "\n")
                continue
            if lvl >= 2:
                # 大纲层级映射为页内 Markdown 标题: H3→##, 更深→###
                depth = 2 if lvl == 3 else 3
                lines.append(f"\n{'#' * depth} {p}\n")
                continue
            md = para_to_markdown(p)
            if md:
                lines.append(md + "\n")
        if page.get("comment"):
            lines.append(
                "\n---\n\n## 网站留言区\n\n"
                "上方为[源文档留言处](https://docs.qq.com/doc/"
                + DOC_ID + ")的同步内容，下方为本站评论区。"
                "网站留言会定期由维护者整理回源文档留言区。\n"
            )
        (DOCS_DIR / page["file"]).write_text("\n".join(lines), encoding="utf-8")
        written.append(page["file"])
        print(f"✓ docs/{page['file']} ({len(body)} 段)")

    # 引言写入 index.md 的同步区块
    if preamble:
        intro = ["<!-- SYNC:INTRO START -->", "## 文档简介\n"]
        for p, lvl in preamble:
            if p.startswith("![]"):
                intro.append(p + "\n")
                continue
            md = para_to_markdown(plain_text(p) and p)
            if md:
                intro.append(md + "\n")
        intro.append("<!-- SYNC:INTRO END -->")
        block = "\n".join(intro)
        index_file = DOCS_DIR / "index.md"
        if index_file.exists():
            content = index_file.read_text(encoding="utf-8")
            content = re.sub(
                r"<!-- SYNC:INTRO START -->.*?<!-- SYNC:INTRO END -->",
                lambda m: block, content, flags=re.S)
        else:
            content = block
        index_file.write_text(content, encoding="utf-8")
        print(f"✓ docs/index.md 引言 ({len(preamble)} 段)")

    # 留言处导出为 JSON, 供前端与 Waline 评论并排展示
    msg = next(((t, b) for t, b in sections if t == "留言处"), None)
    if msg:
        messages = [p for p, _ in msg[1]
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
