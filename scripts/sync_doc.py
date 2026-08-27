#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sync_doc.py — 从腾讯文档抓取《呼市二中学习生活指导》并生成 VitePress Markdown 页面。

用法:
    python scripts/sync_doc.py            # 抓取并生成 docs/ 下所有页面
    python scripts/sync_doc.py --dry-run  # 仅打印解析结果, 不写文件

腾讯文档没有公开的导出 API, 本脚本使用其内部 dop-api 接口读取公开文档正文。
若接口变动导致解析失败, 请手动从腾讯文档导出并替换 docs/ 内容。
"""

import base64
import json
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


def fetch_json():
    req = urllib.request.Request(API, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def read_varint(buf, i):
    value, shift = 0, 0
    while True:
        b = buf[i]
        i += 1
        value |= (b & 0x7F) << shift
        if b < 0x80:
            return value, i
        shift += 7


def extract_chunks(payload):
    """正文以 protobuf 存储: 0x0A + varint 长度 + UTF-8 文本块, 块内换行为 \\r。"""
    text = payload["clientVars"]["collab_client_vars"]["initialAttributedText"]["text"][0]
    raw = base64.b64decode(text + "=" * (-len(text) % 4))
    chunks, i = [], 0
    while i < len(raw):
        if raw[i] == 0x0A:
            try:
                length, j = read_varint(raw, i + 1)
            except IndexError:
                break
            if 0 < length <= len(raw) - j:
                chunk = raw[j:j + length]
                try:
                    chunks.append(chunk.decode("utf-8"))
                    i = j + length
                    continue
                except UnicodeDecodeError:
                    pass
        i += 1
    return chunks


CTRL = "".join(chr(c) for c in list(range(0, 9)) + [0x0B, 0x0C] + list(range(0x0E, 0x20)))


def is_junk(s):
    s = s.strip()
    if not s or set(s) <= {"\x08", " ", "\u3000"}:
        return True
    # 剥离控制字符后再判定(尾部样式表带有 \x05\x06\x00 等前缀)
    cleaned = s.translate({ord(c): None for c in CTRL}).strip()
    if not cleaned:
        return True
    if any(rx.search(cleaned) for rx in JUNK_RES):
        return True
    # 无任何中文/字母/数字的残片(坐标、协议名等)
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
    if not s or set(s) <= {"\x08", " ", "\u3000"}:
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


def main():
    dry = "--dry-run" in sys.argv
    payload = fetch_json()
    chunks = extract_chunks(payload)
    paras = []
    for ch in chunks:
        for ln in ch.replace("\r", "\n").split("\n"):
            ln = ln.strip()
            if not is_junk(ln):
                paras.append(ln)
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

    if dry:
        for _, sec in bounds:
            print(f"--- {sec['title']}: {len(sec['body'])} 段")
        return

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
        messages = [p for p in msg_sec["body"] if len(p) > 1]
        MESSAGES_JSON.parent.mkdir(parents=True, exist_ok=True)
        MESSAGES_JSON.write_text(
            json.dumps({"source": "docs.qq.com/doc/" + DOC_ID, "messages": messages},
                       ensure_ascii=False, indent=2),
            encoding="utf-8")
        print(f"✓ {MESSAGES_JSON.relative_to(ROOT)} ({len(messages)} 条留言)")


if __name__ == "__main__":
    main()
