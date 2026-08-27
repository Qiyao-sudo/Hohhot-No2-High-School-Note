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
    """返回 (全文文本, [(锚点字符位置, 图片URL), ...])"""
    b64 = payload["clientVars"]["collab_client_vars"]["initialAttributedText"]["text"][0]
    raw = base64.b64decode(b64 + "=" * (-len(b64) % 4))
    records = [v for f, v in parse_fields(parse_fields(raw)[0][1])
               if f == 2 and isinstance(v, bytes)]
    text, images = None, []
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
        elif text is None:
            for f, v in parse_fields(r):
                if f == 6 and len(v) > 1000:
                    sub = parse_fields(v)
                    if sub and isinstance(sub[0][1], bytes):
                        try:
                            text = sub[0][1].decode("utf-8")
                            break
                        except UnicodeDecodeError:
                            pass
    return text, images


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
    return re.sub(r"%u([0-9A-Fa-f]{4})", lambda m: chr(int(m.group(1), 16)), s)


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


def build_lines(text, images, url_map):
    """把全文文本按 \\r 拆行, 并在图片锚点处插入 Markdown 图片行。"""
    imgs = sorted(
        [(pos, url) for pos, url in images if url in url_map], key=lambda t: t[0])
    out, buf = [], []
    next_img = 0
    for i, ch in enumerate(text):
        while next_img < len(imgs) and imgs[next_img][0] <= i:
            pos, url = imgs[next_img]
            if buf:
                out.append("".join(buf))
                buf = []
            out.append(f"![](/images/{url_map[url]})")
            next_img += 1
        if ch == "\r":
            out.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    if buf:
        out.append("".join(buf))
    return [ln.strip() for ln in out if not is_junk(ln)]


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
    text, images = extract_doc(payload)
    if not text:
        print("✗ 未能解析文档正文")
        sys.exit(1)
    print(f"正文 {len(text)} 字符, {len(images)} 张图片")

    if dry:
        for pos, url in sorted(images)[:5]:
            print(f"  img@{pos} {url[:70]}")
        return

    if "--no-img" in sys.argv:
        url_map = {url: "" for _, url in images}
        paras = build_lines(text, [], {})
        img_count = 0
    else:
        print("下载图片…")
        url_map = download_images(images)
        paras = build_lines(text, images, url_map)
        img_count = sum(1 for p in paras if p.startswith("![]"))
        print(f"图片下载完成: {len(url_map)} 张, 嵌入 {img_count} 张")
    print(f"解析到 {len(paras)} 个有效段落")

    # 文档尾部是导入 Word 时残留的样式表/设置 XML(纯 ASCII)。
    # 找到连续 12 行不含中文的位置, 视为正文结束。
    for i in range(len(paras) - 12):
        if all(not re.search(r"[\u4e00-\u9fff]", p) for p in paras[i:i + 12]):
            print(f"正文结束于第 {i} 段(其后为导入残留, 共略去 {len(paras) - i} 段)")
            paras = paras[:i]
            break

    bounds = []
    for sec in SECTIONS:
        start = next((i for i, p in enumerate(paras) if p in sec["headings"]), None)
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
        for p in sec["body"]:
            if p.startswith("![]"):
                lines.append(p + "\n")
                continue
            if p.startswith("关于") and len(p) <= 16:
                lines.append(f"\n## {p}\n")
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
        messages = [p for p in msg_sec["body"] if len(p) > 1 and not p.startswith("![")]
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
