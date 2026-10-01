"""Extract only the ALL sheet from the official CEFR-J Wordlist 1.6 archive.

Python 3 standard library only. The output is local and deliberately untracked.
"""

import argparse
import hashlib
import io
import json
import os
import urllib.request
import xml.etree.ElementTree as ET
import zipfile


URL = "https://www.cefr-j.org/data/CEFRJ_wordlist_ver1.6.zip"
SHA256 = "c837d2c00ab8954ed8db48e79afd8ef37099570295fec36950dbf9322303a37a"
PROVENANCE = (
    "The CEFR-J Wordlist Version 1.6. Compiled by Yukio Tono, "
    "Tokyo University of Foreign Studies. Retrieved from https://www.cefr-j.org/download.html on 2026-10-01."
)
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def cells(worksheet, shared):
    for xml_row in worksheet.findall(f".//{NS}sheetData/{NS}row"):
        values = {}
        for cell in xml_row.findall(f"{NS}c"):
            column = "".join(char for char in cell.attrib["r"] if char.isalpha())
            raw = cell.find(f"{NS}v")
            if cell.attrib.get("t") == "inlineStr":
                value = "".join(node.text or "" for node in cell.findall(f".//{NS}t"))
            elif raw is None:
                value = None
            elif cell.attrib.get("t") == "s":
                value = shared[int(raw.text)]
            else:
                value = raw.text
            values[column] = value
        yield values


def extract(data):
    if hashlib.sha256(data).hexdigest() != SHA256:
        raise ValueError("Official archive SHA-256 mismatch; inspect the release before importing")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
        if names != ["CEFR-J Wordlist Ver1.6.xlsx"]:
            raise ValueError("Unexpected CEFR-J archive contents")
        with zipfile.ZipFile(io.BytesIO(archive.read(names[0]))) as workbook:
            strings = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
            shared = ["".join(node.text or "" for node in item.iter(f"{NS}t"))
                      for item in strings.findall(f"{NS}si")]
            # The signed 1.6 workbook has README as sheet1 and ALL as sheet2.
            worksheet = ET.fromstring(workbook.read("xl/worksheets/sheet2.xml"))
            source_rows = list(cells(worksheet, shared))
    if [source_rows[0].get(col) for col in ("A", "B", "C")] != ["headword", "pos", "CEFR"]:
        raise ValueError("Unexpected ALL sheet header")
    rows = [{"headword": row.get("A"), "pos": row.get("B"), "CEFR": row.get("C")}
            for row in source_rows[1:]]
    if len(rows) != 7801:
        raise ValueError(f"Expected 7801 source rows, got {len(rows)}")
    return {"dataset": "CEFR-J Vocabulary Profile", "version": "1.6",
            "provenance": PROVENANCE, "rows": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", help="Previously downloaded official ZIP (default: download it)")
    parser.add_argument("--output", required=True, help="Local manifest JSON output path")
    args = parser.parse_args()
    if args.archive:
        with open(args.archive, "rb") as source:
            data = source.read()
    else:
        with urllib.request.urlopen(URL, timeout=60) as source:
            data = source.read()
    result = extract(data)
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as target:
        json.dump(result, target, ensure_ascii=False, separators=(",", ":"))
    print(f"Extracted {len(result['rows'])} CEFR-J 1.6 rows to {args.output}")


if __name__ == "__main__":
    main()
