#!/usr/bin/env python3
"""Genera operations/audit/IMP-09/eex-exchange-calendar.json (prescripción 2).

Reglas del calendario OFICIAL de Exchange Days de Gas Futures EEX — fuentes
descargadas con URL, fecha y SHA-256 (ver 'sources' del JSON):
  1. Holiday Calendar Derivatives & Emissions Spot (EEX, 19-06-2025, PDF):
     "Exchange days are all business days Monday to Friday which are not one of
     the below mentioned [holidays]" y "The calendar is applicable continuously
     for all years until further notice" → la regla es continua, no por año.
     La tabla del PDF marca en la columna Natural Gas la X (mercado cerrado
     todo el día) para New Year 01-01, Good Friday, Easter Monday, Labour Day
     01-05, Christmas Day 25-12 y Boxing Day 26-12. La etiqueta textual de las
     filas de diciembre aparece desplazada en el PDF ("Christmas Day" junto a
     "24th December"), pero son la fecha (24, 25 y 26) y la X de la columna las
     que fijan el holiday set: 25 y 26 cerrados; 24 y 31 son Orderbook
     08:00-13:00 CET (Exchange Days de horario acortado, no festivos).
  2. Natural Gas Trading Calendar 2026 (xlsx oficial 2026): la columna
     "Exchange Holidays - Natural Gas Futures" de la hoja "2026 Natural Gas
     Holidays" lista 2026-01-01, 2026-04-03, 2026-04-06, 2026-05-01 y
     2026-12-25. Boxing Day 26-12-2026 cae en sábado: no es un Exchange Day y
     por eso no aparece en esa columna; el xlsx registra Boxing Day 2026-12-28
     como Bank Holiday de Natural Gas Spot, no como exchange holiday de
     Futures. El script PARSEA la hoja real del xlsx (no compara contra un set
     hardcodeado) y verifica que el holiday set de 2026 derivado, restringido a
     días hábiles (lun-vie), coincide exactamente con esa columna.

Exchange Days 2020-2026: día hábil Mon-Fri NO incluido en el holiday set del
Gas Futures (Pascua por el algoritmo Gregoriano anónimo, documentación fixing).
NO se usan particiones del lago ni heurísticas de fines de semana: es el
calendario oficial con su fuente ligada.

Uso:
  python3 build-eex-exchange-calendar.py            # verifica y regenera el JSON
  python3 build-eex-exchange-calendar.py --check    # solo verifica las fuentes
"""

import hashlib
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
XLSX = os.path.join(HERE, "sources", "20260121_NaturalGasTradingCalendar2026.xlsx")
PDF = os.path.join(HERE, "sources", "EEX_Trading_Calendar_Emissions_Spot__Derivatives.pdf")
OUT = os.path.join(HERE, "eex-exchange-calendar.json")
XLSX_URL = "https://www.eex.com/fileadmin/EEX/Downloads/Trading/Calendar/Natural_Gas_Trading_Calendar/20260121_NaturalGasTradingCalendar2026.xlsx"
PDF_URL = "https://www.eex.com/fileadmin/EEX/Downloads/Trading/Calendar/Holiday_Calendar/EEX_Trading_Calendar_Emissions_Spot__Derivatives.pdf"
RETRIEVED_AT_UTC = "2026-09-23T22:51:00Z"

XLSX_SHEET = "2026 Natural Gas Holidays"
XLSX_FUTURES_DATE_COLUMN = "E"
XLSX_FUTURES_EVENT_COLUMN = "F"

YEARS = list(range(2020, 2027))

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"m": MAIN_NS}
T = f"{{{MAIN_NS}}}t"


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def easter_sunday(year):
    # Algorithm of Anonymous Gregorian Computing (determinista, sólo aritmética
    # entera; estándar para el calendario ecclesiástico occidental).
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def gas_futures_holidays(year):
    # Holiday set OFICIAL del Gas Futures EEX (PDF continuo, columna Natural
    # Gas de la tabla): 01-01, Good Friday, Easter Monday, 01-05, 25-12 y
    # Boxing Day 26-12. 24-12 y 31-12 son Exchange Days de horario acortado.
    easter = easter_sunday(year)
    return {
        "New Year's Day": date(year, 1, 1),
        "Good Friday": date.fromordinal(easter.toordinal() - 2),
        "Easter Monday": date.fromordinal(easter.toordinal() + 1),
        "Labour Day": date(year, 5, 1),
        "Christmas Day": date(year, 12, 25),
        "Boxing Day": date(year, 12, 26),
    }


def iso(day):
    return day.isoformat()


def excel_serial_to_date(value):
    # Sistema de fechas 1900 de Excel: el origen práctico es 1899-12-30
    # (absorbe el bug del 29-02-1900). Las celdas E del xlsx son seriales
    # enteros sin parte horaria.
    return date(1899, 12, 30) + timedelta(days=int(float(value)))


def _shared_strings(archive):
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    values = []
    for item in root.findall("m:si", NS):
        values.append("".join(node.text or "" for node in item.iter(T)))
    return values


def read_sheet_cells(xlsx_path, sheet_name):
    # Parser mínimo xlsx (zip + XML, sólo biblioteca estándar): devuelve
    # {row_number: {column: value}} resolviendo strings compartidos.
    with zipfile.ZipFile(xlsx_path) as archive:
        shared = _shared_strings(archive)
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {rel.get("Id"): rel.get("Target") for rel in relationships}
        target = None
        for sheet in workbook.findall("m:sheets/m:sheet", NS):
            if sheet.get("name") == sheet_name:
                target = targets.get(sheet.get(f"{{{REL_NS}}}id"))
        if target is None:
            raise SystemExit(f"no existe la hoja '{sheet_name}' en {xlsx_path}")
        sheet = ET.fromstring(archive.read("xl/" + target.lstrip("/")))
        rows = {}
        for row in sheet.findall("m:sheetData/m:row", NS):
            for cell in row.findall("m:c", NS):
                ref = cell.get("r")
                column = re.match(r"[A-Z]+", ref).group(0)
                number = int(re.search(r"\d+", ref).group(0))
                kind = cell.get("t")
                value_node = cell.find("m:v", NS)
                inline = cell.find("m:is", NS)
                if kind == "s" and value_node is not None:
                    value = shared[int(value_node.text)]
                elif inline is not None:
                    value = "".join(node.text or "" for node in inline.iter(T))
                elif value_node is not None:
                    value = value_node.text
                else:
                    value = None
                rows.setdefault(number, {})[column] = value
        return rows


def xlsx_futures_exchange_holidays(xlsx_path):
    # Columna OFICIAL "Exchange Holidays - Natural Gas Futures" de la hoja
    # "2026 Natural Gas Holidays" (E = fecha serial, F = evento). Devuelve
    # {iso: evento}. Las celdas de fecha sin evento (filas de las columnas de
    # Spot) y los encabezados textuales se descartan.
    rows = read_sheet_cells(xlsx_path, XLSX_SHEET)
    holidays = {}
    for number in sorted(rows):
        cells = rows[number]
        raw_date = cells.get(XLSX_FUTURES_DATE_COLUMN)
        event = cells.get(XLSX_FUTURES_EVENT_COLUMN)
        if not raw_date or not event:
            continue
        if not re.fullmatch(r"\d+(\.\d+)?", str(raw_date)):
            continue
        holidays[excel_serial_to_date(raw_date).isoformat()] = event
    return holidays


def verify_sources():
    # La verificación LEE el xlsx oficial (no un set hardcodeado): el holiday
    # set derivado de 2026, restringido a días hábiles (lun-vie), debe coincidir
    # exactamente con la columna "Exchange Holidays - Natural Gas Futures".
    xlsx_holidays = xlsx_futures_exchange_holidays(XLSX)
    derived = gas_futures_holidays(2026)
    derived_exchange = {iso(day): name for name, day in derived.items() if day.weekday() < 5}
    derived_all = {iso(day): name for name, day in derived.items()}

    if set(xlsx_holidays) != set(derived_exchange):
        raise SystemExit(
            "El holiday set derivado de 2026 (días hábiles) no coincide con la columna "
            f"oficial 'Exchange Holidays - Natural Gas Futures' del xlsx: derivado {sorted(derived_exchange)}, xlsx {sorted(xlsx_holidays)}"
        )
    missing = set(xlsx_holidays) - set(derived_all)
    if missing:
        raise SystemExit(f"El xlsx oficial de 2026 lista holidays ausentes del set derivado: {sorted(missing)}")
    return xlsx_holidays, derived


def build_manifest():
    xlsx_holidays, _ = verify_sources()

    exchange_days = []
    holidays_by_year = {}
    for year in YEARS:
        holidays = gas_futures_holidays(year)
        holiday_days = {day for day in holidays.values() if day.year == year}
        holidays_by_year[year] = {name: value.isoformat() for name, value in sorted(holidays.items(), key=lambda item: item[1])}
        cursor = date(year, 1, 1)
        end = date(year, 12, 31)
        while cursor <= end:
            if cursor.weekday() < 5 and cursor not in holiday_days:
                exchange_days.append(cursor.isoformat())
            cursor = date.fromordinal(cursor.toordinal() + 1)

    return {
        "artifactKind": "IMP-09_EEX_OFFICIAL_EXCHANGE_CALENDAR",
        "scope": "EEX Natural Gas (derivatives/Futures) Exchange Days 2020-2026",
        "method": "Días hábiles Mon-Fri del calendario gregoriano menos el holiday set OFICIAL del Gas Futures EEX (PDF Holiday Calendar: regla continua 'applicable continuously for all years until further notice', columna Natural Gas: 01-01, Good Friday, Easter Monday, 01-05, 25-12 y Boxing Day 26-12; fechas de Pascua por el algoritmo Gregoriano anónimo). Verificación: el holiday set de 2026 derivado, restringido a días de intercambio (lun-vie), coincide exactamente con la columna 'Exchange Holidays - Natural Gas Futures' de la hoja '2026 Natural Gas Holidays' del xlsx oficial, PARSEADA por este script.",
        "notes": "24-12 y 31-12: orderbook 08:00-13:00 CET para Gas derivatives (siguen siendo Exchange Days); el corte de IMP-09 (TOB <= 11:00 Berlin) queda dentro de dicha ventana. Boxing Day (26-12) es holiday de Natural Gas segun la regla continua del PDF; en 2026 cae en sabado y por eso no figura en la columna de exchange holidays de Futures del xlsx, que registra 'Boxing Day 2026-12-28' solo como Bank Holiday de Natural Gas Spot. Sin heuristicas: ni particiones del lake ni fines de semana deducidos.",
        "retrievedAtUtc": RETRIEVED_AT_UTC,
        "sources": [
            {
                "path": "sources/EEX_Trading_Calendar_Emissions_Spot__Derivatives.pdf",
                "url": PDF_URL,
                "sha256": sha256_file(PDF),
            },
            {
                "path": "sources/20260121_NaturalGasTradingCalendar2026.xlsx",
                "url": XLSX_URL,
                "sha256": sha256_file(XLSX),
            },
        ],
        "verifiedXlsx2026ExchangeHolidays": sorted(xlsx_holidays),
        "holidaysByYear": holidays_by_year,
        "exchangeDayCount": len(exchange_days),
        "exchangeDays": exchange_days,
    }


def main():
    manifest = build_manifest()
    if "--check" in sys.argv:
        print(f"verificado: {manifest['exchangeDayCount']} Exchange Days 2020-2026; xlsx 2026 = {manifest['verifiedXlsx2026ExchangeHolidays']}")
        return
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    print(f"escrito {OUT}: {manifest['exchangeDayCount']} Exchange Days 2020-2026")


if __name__ == "__main__":
    main()
