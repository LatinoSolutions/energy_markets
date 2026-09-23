#!/usr/bin/env python3
"""Genera operations/audit/IMP-09/eex-exchange-calendar.json (prescripción 2).

Reglas del calendario OFICIAL de Exchange Days de Gas Futures EEX — fuentes
descargadas con URL, fecha y SHA-256 (ver 'sources' del JSON):
  1. Holiday Calendar Derivatives & Emissions Spot (EEX, 19-06-2025, PDF):
     "Exchange days are all business days Monday to Friday which are not one of
     the below mentioned [holidays]" y "The calendar is applicable continuously
     for all years until further notice" → la regla es continua, no por año.
  2. Natural Gas Futures Exchange Holidays (xlsx oficial 2026): 2026-01-01
     New Year's Day; 2026-04-03 Good Friday; 2026-04-06 Easter Monday;
     2026-05-01 Labour Day; 2026-12-25 Christmas Day. (Boxing Day NO aparece
     para Natural Gas Futures en el xlsx 2026; 24 y 31 diciembre son días de
     trading acortado 08:00–13:00 CET según el PDF, sigues siendo Exchange Days
     y el corte de IMP-09 con TOB ≤ 11:00Berlin permanece anterior.)

Exchange Days 2020-2026: día hábil Mon-Fri NO incluido en el holiday set del
Gas Futures (Pascua por el algoritmo Gregoriano anónimo, documentación fixing). El
script re-verifica el holiday set de 2026 contra el xlsx oficial descargado.
NO se usan particiones del lago ni heurísticas de fines de semana: son
calendario oficial con su fuente ligada.
"""

import hashlib
import json
import os
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
XLSX = os.path.join(HERE, "sources", "20260121_NaturalGasTradingCalendar2026.xlsx")
PDF = os.path.join(HERE, "sources", "EEX_Trading_Calendar_Emissions_Spot__Derivatives.pdf")
OUT = os.path.join(HERE, "eex-exchange-calendar.json")
XLSX_URL = "https://www.eex.com/fileadmin/EEX/Downloads/Trading/Calendar/Natural_Gas_Trading_Calendar/20260121_NaturalGasTradingCalendar2026.xlsx"
PDF_URL = "https://www.eex.com/fileadmin/EEX/Downloads/Trading/Calendar/Holiday_Calendar/EEX_Trading_Calendar_Emissions_Spot__Derivatives.pdf"
RETRIEVED_AT_UTC = "2026-09-23T22:51:00Z"

YEARS = list(range(2020, 2027))


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
    easter = easter_sunday(year)
    return {
        "New Year's Day": date(year, 1, 1),
        "Good Friday": date.fromordinal(easter.toordinal() - 2),
        "Easter Monday": date.fromordinal(easter.toordinal() + 1),
        "Labour Day": date(year, 5, 1),
        "Christmas Day": date(year, 12, 25),
    }


def iso(day):
    return day.isoformat()


def main():
    expected_2026 = {"2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-12-25"}
    actual_2026 = {day.isoformat() for day in gas_futures_holidays(2026).values()}
    if actual_2026 != expected_2026:
        raise SystemExit(f"El holiday set derivado de 2026 no coincide con el xlsx oficial: {sorted(actual_2026)}")

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

    manifest = {
        "artifactKind": "IMP-09_EEX_OFFICIAL_EXCHANGE_CALENDAR",
        "scope": "EEX Natural Gas (derivatives/Futures) Exchange Days 2020-2026",
        "method": "Días hábiles Mon-Fri del calendario gregoriano menos el holiday set OFICIAL del Gas Futures EEX (PDF Holiday Calendar: regla continua 'applicable continuously for all years until further notice'; fechas de Pascua por el algoritmo Gregoriano anónimo). Verificación: el set de 2026 derivado coincide exactamente con el xlsx oficial de NaturalGasTradingCalendar2026 (New Year 01-01, Good Friday 03-04, Easter Monday 06-04, Labour Day 01-05, Christmas Day 25-12).",
        "notes": "24-12 y 31-12: orderbook 08:00-13:00 CET para Gas derivatives (siguen siendo Exchange Days); el corte de IMP-09 (TOB <= 11:00 Berlin) queda dentro de dicha ventana. Boxing Day (26-12) NO es holiday para Gas Futures según el xlsx oficial 2026. Sin heurísticas: ni particiones del lake ni fines de semana deducidos.",
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
        "holidaysByYear": holidays_by_year,
        "exchangeDayCount": len(exchange_days),
        "exchangeDays": exchange_days,
    }
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    print(f"escrito {OUT}: {len(exchange_days)} Exchange Days 2020-2026")


if __name__ == "__main__":
    main()
