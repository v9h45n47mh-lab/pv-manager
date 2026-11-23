# PV Manager

Home-Assistant-Karte für PV, Netz, Haus und Batteriespeicher. Die komplette Oberfläche verwendet das lokal gebündelte **HA UI Kit 1.9.6**. Keine CDN-Abhängigkeit, keine Cloud und keine zusätzliche Diagrammkarte nötig.

## Funktionen

- Die wandernden Punkte im Energiefluss zeigen die Richtung an. Kleine Leistungen werden mit wenigen Punkten dargestellt, bei höherer Leistung steigt die Anzahl auf bis zu acht pro Verbindung.
- Zeitraumwahl wie in der Wetteranalyse mit Schaltflächen, Pfeilen und freier Datumsauswahl. Die Jahresansicht zeigt Monatssummen.
- Ein Energie-Balkendiagramm. Tag mit 15-Minuten-Summen, Woche und Monat mit Tagessummen, Jahr mit Monatssummen.
- Erzeugung, Verbrauch und Netzbezug in kWh. Die farbigen Legendeneinträge zeigen die Zeitraum-Summen und schalten ihre Balken ein oder aus.
- Einzelwerte mit Maus, Finger oder Pfeiltasten; Anzeige oberhalb des Diagramms.
- Suchbare Sensorzuordnung und anpassbare Vorzeichen. Batterie und kWh-Zähler optional. Mehrere unabhängige Karten über `card_id`.
- Zentrale Einstellungen pro Karte, Änderungen durch HA-Administratoren. Die historischen Abfragen laufen mit den HA-Berechtigungen des betrachtenden Nutzers.

## Installation mit HACS

1. HACS → Benutzerdefinierte Repositories → `https://github.com/v9h45n47mh-lab/pv-manager`, Kategorie **Integration**.
2. **PV Manager** herunterladen und Home Assistant neu starten.
3. Einstellungen → Geräte & Dienste → Integration hinzufügen → **PV Manager**.
4. Dashboard bearbeiten → Karte hinzufügen → **PV Manager**. Falls die Karte noch fehlt, Browser neu laden.
5. Zahnrad der Karte öffnen, Sensoren und Vorzeichen prüfen und speichern.

PV Manager registriert die Karte als Dashboard-Ressource und aktualisiert die Ressourcen-URL bei einem Versionswechsel. Wenn du die Dashboard-Ressourcen über YAML verwaltest, lädt PV Manager die Karte automatisch nach dem Start des Home-Assistant-Frontends. Eine in YAML eingetragene Kartenressource hat Vorrang.

Nach einem Update Home Assistant neu starten und das Dashboard im Browser neu laden.

## Manuelle Installation

`pv-manager-manual.zip` vom Release herunterladen und im Home-Assistant-Konfigurationsverzeichnis entpacken. Danach muss `custom_components/pv_manager/manifest.json` vorhanden sein. Neu starten und ab Schritt 3 fortfahren. `pv-manager.zip` ist das HACS-Paket und enthält den Inhalt des Integrationsordners ohne äußere Ordnerstruktur.

```yaml
type: custom:pv-manager-card
card_id: pv_hauptanlage
title: PV-Anlage
```

Für eine zweite Karte eine eigene `card_id` verwenden. Diese darf Buchstaben, Ziffern, Bindestriche und Unterstriche enthalten. Die im Zahnrad gespeicherte Konfiguration hat Vorrang vor YAML-Vorschlägen.

## Sensoren

| Verwendung | Sofar-Vorschlag | Erwartete Einheit |
| --- | --- | --- |
| PV | `sensor.inverter_pv_power` | W / kW / MW |
| Netz | `sensor.inverter_grid_power` | W / kW / MW |
| Haus | `sensor.inverter_load_power` | W / kW / MW |
| Batterie | `sensor.inverter_battery_power` | W / kW / MW |
| Ladezustand | `sensor.inverter_battery` | % |
| Erzeugung | `sensor.inverter_today_production` | Wh / kWh / MWh |
| Verbrauch | `sensor.inverter_today_load_consumption` | Wh / kWh / MWh |
| Netzbezug | `sensor.inverter_today_energy_import` | Wh / kWh / MWh |

Für Sofar misst `sensor.inverter_pv_power` die Leistung der Module. Der AC-Ausgang `sensor.inverter_power` kann zusätzlich Batterieentladung enthalten. Karten mit dem alten Standardpaar aus AC-Ausgang und `sensor.inverter_load_power` verwenden automatisch den PV-Eingang, sobald diese Entität verfügbar ist.

Standard: positiver Netzwert = **Bezug**, positiver Batteriewert = **Entladen**. Beide Regeln sind umkehrbar. Bitte anhand realer Einspeisung/Ladung prüfen. Energieflussverbindungen sind rechnerische Zuordnungen aus den Gesamtleistungen mit Priorität PV → Haus → Batterie → Netz. Die Bilanz kann durch Messzeitpunkte, Wechselrichterverluste oder falsche Zuordnung abweichen; eine größere Abweichung wird angezeigt. Einzelne Herkunftsflüsse werden nicht separat gemessen.

## Historische Daten

Der aktuelle Tag zeigt die letzten 24 Stunden. Die aktuelle Woche umfasst heute und die sieben vorherigen Tage. Mit den Pfeilen springst du zu vollständigen Kalendertagen, Kalenderwochen (Montag bis Sonntag), Monaten und Jahren. Ein freier Zeitraum umfasst beide gewählten Daten und bis zu 366 Kalendertage.

Der Verlauf summiert die Recorder-Energieänderungen in kWh. Manuell zugeordnete Energiezähler haben Vorrang. Automatisch erkannte Sofar-Tageszähler werden auch als importierte Statistiken ohne Live-Entität gefunden. Wenn ihre Statistik fehlt, sucht die Karte nach passenden Gesamtzählern und weiteren Sofar-Sensornamen. Fehlt auch dort die Statistik, kann die Karte Energie aus erfassten Leistungswerten schätzen und kennzeichnet die Kennzahl. Beim geschätzten Netzbezug zählt nur die Bezugsrichtung.

Die Tagesansicht summiert die 5-Minuten-Statistiken zu Viertelstunden. Historische Tage mit ausschließlich stündlicher Zählerhistorie zeigen Stundenwerte. Wochen, Monate und frei gewählte Zeiträume zeigen Tagessummen, Jahre zeigen Monatssummen. Kalendergrenzen verwenden die Zeitzone von Home Assistant. Fehlende Werte bleiben leer. Die Legende summiert die erfassten Intervalle.

## Entwicklung

```sh
npm install
npm run build
npm run check
npm test
npx playwright install chromium
npm run test:browser
npm run package
```

`tests/demo.html` ist eine lokale Vorschau mit klaren Beispieldaten. Die produktive Karte enthält keine Demowerte. Die festen UI-Dateien samt Lizenz und Prüfsummen liegen unter `frontend/family-ui/1.9.6`. Änderungen an gemeinsamem Aussehen erfolgen im [HA UI Kit](https://github.com/v9h45n47mh-lab/ha-ui-kit).

## PV-Manager-Icon

![PV Manager](brand/icon.png)

Das eigene Icon wird ab Version 1.0.2 unter `custom_components/pv_manager/brand/` sowie im Repository für HACS mitgeliefert. Helle und dunkle Varianten liegen in 256 und 512 Pixeln mit transparentem Hintergrund vor. Die Darstellung im HACS-Katalog hängt von dessen lokaler Brand-Unterstützung ab.

Die editierbare Quelle ist `brand/pv.svg` innerhalb des Integrationsordners. Für eine erneute Rasterung steht `scripts/build_icons.cjs` bereit (Entwicklungswerkzeug: `npm install --no-save sharp`, danach `node scripts/build_icons.cjs`). Auf Home Assistant werden keine weiteren Pakete benötigt.
