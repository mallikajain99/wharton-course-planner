"""Read a planner export (.xlsx) with the standard library only, and print or check it.

    python3 read_xlsx.py plan.xlsx            # print every tab as tab-separated rows
    python3 read_xlsx.py plan.xlsx --check    # structural check: valid zip, valid XML, tab names, row counts

Used by the export test and to compare a student's export with their dashboard.
"""
import sys, zipfile, re
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}


def col_index(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n - 1


def read(path):
    z = zipfile.ZipFile(path)
    assert z.testzip() is None, "zip is corrupt"
    for name in z.namelist():
        if name.endswith(".xml") or name.endswith(".rels"):
            ET.fromstring(z.read(name))          # raises if any part isn't well-formed XML
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    target = {r.get("Id"): r.get("Target") for r in rels}
    out = []
    for sh in wb.find("m:sheets", NS):
        rid = sh.get("{%s}id" % NS["r"])
        x = ET.fromstring(z.read("xl/" + target[rid]))
        rows = []
        for row in x.find("m:sheetData", NS):
            cells = {}
            for c in row:
                t = c.get("t")
                if t == "inlineStr":
                    v = "".join(e.text or "" for e in c.iter("{%s}t" % NS["m"]))
                else:
                    ve = c.find("m:v", NS)
                    v = ve.text if ve is not None else ""
                cells[col_index(c.get("r"))] = v
            rows.append([cells.get(i, "") for i in range(max(cells) + 1)] if cells else [])
        out.append((sh.get("name"), rows))
    return out


if __name__ == "__main__":
    sheets = read(sys.argv[1])
    if "--check" in sys.argv:
        for name, rows in sheets:
            assert len(name) <= 31 and not re.search(r"[\[\]:*?/\\]", name), "bad tab name: " + name
            print("%-32s %d rows" % (name, len(rows)))
        print("XLSX OK")
    else:
        for name, rows in sheets:
            print("=== " + name)
            for r in rows:
                print("\t".join(r))
