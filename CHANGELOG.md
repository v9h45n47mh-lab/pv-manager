# Changelog

## 1.0.8 – 2026-11-18

- Die Karte wird als Dashboard-Ressource registriert. So ist das Kartenelement beim Laden des Dashboards verfügbar.
- Bei YAML-Ressourcen startet die automatische Kartenregistrierung erst mit dem Home-Assistant-Frontend.

## 1.0.7 – 2026-11-18

- Zeitraumwahl wie in der Wetteranalyse mit Schaltflächen, Kalenderpfeilen und frei wählbaren Daten. Der aktuelle Tag zeigt die letzten 24 Stunden, die aktuelle Woche heute und die vorherigen sieben Tage.
- Der Verlauf erkennt Sofar-Tageszähler auch in importierten Recorder-Statistiken. Für ältere Tage mit stündlicher Zählerhistorie zeigt er Stundenwerte.

## 1.0.6 – 2026-11-17

- PV-Verlauf erkennt Sofar-Energiezähler passend zu den Leistungssensoren. Bei fehlender Zählerstatistik schätzt die Karte die Energie aus vorhandenen Recorder-Leistungswerten.
- Ganzzahlige kWh-Skala mit HA UI Kit 1.9.4. Balkenhöhe, Intervallwerte und Summen behalten ihre Genauigkeit.

## 1.0.5 – 2026-11-17

- Ein Balkendiagramm mit summierter Erzeugung, summiertem Verbrauch und summiertem Netzbezug in kWh.
- Interaktive Legende mit Zeitraum-Summen und gemeinsamen Energiefarben aus HA UI Kit 1.9.3.

## 1.0.4 – 2026-11-17

- Gleiche Auflösung für alle Balkendiagramme: Tag 15 Minuten, Woche und Monat Kalendertage, Jahr Kalendermonate.
- Leistungskennzahlen, Ladezustand und Energiezähler je Diagramm einzeln ein- und ausblenden.

## 1.0.3 – 2026-11-17

- Leistung, Batterie-Ladezustand und Energie durchgängig als Balkendiagramme.
- HA UI Kit 1.9.2 positioniert dichte Balkengruppen ohne Überlagerung und zeigt bei positiven und negativen Werten eine Nulllinie.

## 1.0.2 – 2026-11-17

- Datenreihen im Energie-Balkendiagramm einzeln ein- und ausblenden. Die Karte verwendet dafür die gemeinsame Checkbox-Gruppe aus HA UI Kit 1.9.1.
- Eigenes PV-Manager-Icon mit Sonne und Solarmodul für Integration und HACS; transparente PNGs in 256/512 px sowie helle/dunkle Variante.

## 1.0.1 – 2026-11-17

- Lesbare Diagrammbeschriftung und größere Diagramme auf schmalen Karten.
- Einzelwertanzeige initial mit dem letzten Intervall gefüllt.
- Zusätzlicher Abstand unter Energiefluss-Knoten; UI Kit 1.9.1 lokal gebündelt.

## 1.0.0 – 2026-11-17

- Erste Veröffentlichung mit Energiefluss, PV/Netz/Haus/Batterie und SOC.
- Recorder-Verläufe für Leistung, Ladezustand und Energie; Tag/Woche/Monat/Jahr.
- UI Kit 1.9.0 vollständig lokal gebündelt, inklusive neuer gemeinsamer Energie- und Diagrammkomponenten.
- Zentrale Einstellungen, Sensorensuche, Vorzeichen, mehrere Karten und Adminschutz.
