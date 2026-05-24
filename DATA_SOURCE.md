# FuelRadar Data Source

## Source

FuelRadar should use the official MIMIT open data for fuel station registry and
prices.

Official pages:

- MIMIT open data portal: <https://www.mimit.gov.it/it/open-data>
- Dataset page: <https://www.mimit.gov.it/index.php/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti?hitcount=0>
- Metadata PDF: <https://www.mimit.gov.it/images/stories/opendata/Metadati_27feb_prezzi_carburanti.pdf>

Daily CSV files:

- Station registry: <https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv>
- Prices: <https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv>

## Verified On 2026-05-24

The daily CSV endpoints responded with:

- `Content-Type: text/csv`;
- `ETag`;
- `Last-Modified`;
- `Content-Length`;
- `Accept-Ranges: bytes`.

Observed file sizes:

- `prezzo_alle_8.csv`: about 3.8 MB;
- `anagrafica_impianti_attivi.csv`: about 3.5 MB.

This is small enough to validate a direct on-device import before adding a
backend.

## Current Format

Both daily files start with an extraction line:

```txt
Estrazione del YYYY-MM-DD
```

The next line is the header.

The current field separator is `|`.

This matters because older metadata mentions `;`, while the MIMIT dataset page
states that the separator for the daily registry and price files changed from
2026-02-10.

## Price File

File:

```txt
prezzo_alle_8.csv
```

Observed header:

```txt
idImpianto|descCarburante|prezzo|isSelf|dtComu
```

Fields:

- `idImpianto`: station identifier;
- `descCarburante`: fuel description;
- `prezzo`: price with decimal point and three decimals;
- `isSelf`: `1` for self-service, `0` for served;
- `dtComu`: date and time when the price was communicated by the station
  operator.

Important notes:

- prices are expressed in euros;
- fuel is generally per liter, except methane/metano which is per kg;
- the file represents prices in force at 8 in the morning on the extraction
  date;
- `dtComu` can be older than the extraction date.

## Station Registry File

File:

```txt
anagrafica_impianti_attivi.csv
```

Observed header:

```txt
idImpianto|Gestore|Bandiera|Tipo Impianto|Nome Impianto|Indirizzo|Comune|Provincia|Latitudine|Longitudine
```

Fields:

- `idImpianto`: station identifier;
- `Gestore`: operator company;
- `Bandiera`: brand;
- `Tipo Impianto`: road type;
- `Nome Impianto`: station name;
- `Indirizzo`: address;
- `Comune`: city;
- `Provincia`: province code or name, depending on source data;
- `Latitudine`: latitude in decimal degrees;
- `Longitudine`: longitude in decimal degrees.

Important notes:

- coordinates are entered voluntarily by operators and may not always be
  verified;
- import code must handle missing, malformed, or inaccurate coordinates;
- rows without valid coordinates cannot be shown on the map.

## Fuel Normalization

The MVP should support these normalized fuel types:

- `benzina`;
- `diesel`;
- `gpl`;
- `metano`.

Initial mapping:

- `Benzina` -> `benzina`;
- `Gasolio` -> `diesel`;
- `GPL` -> `gpl`;
- `Metano` -> `metano`.

Special fuel names should be ignored in the MVP unless explicitly mapped later.

## Price Freshness Rule

The product decision is to show prices from the latest daily MIMIT dataset.

For the MIMIT daily files, there are two relevant dates:

- the extraction date in the first line;
- the communication date in `dtComu`.

MVP rule:

- keep prices that are present in the latest successfully imported daily price
  file;
- do not require the date part of `dtComu` to match the extraction date;
- show the extraction date and `dtComu` in the UI where useful.

Reason:

- `dtComu` is when the station operator communicated the price;
- a price can still be in force in the daily MIMIT extraction even if it was
  communicated before the extraction date;
- filtering strictly on same-day `dtComu` hides too many valid stations,
  especially for GPL and metano self-service.

## Refresh Strategy

On app startup:

- check local dataset metadata;
- request remote headers for both CSV files;
- compare `ETag` and `Last-Modified` when available;
- skip download if both local and remote metadata indicate unchanged data;
- download and import only when data changed.

Manual refresh:

- use the same metadata-aware flow;
- never delete the last valid local dataset before the new import succeeds.

Offline behavior:

- use the last valid local dataset;
- show the extraction date clearly;
- show a clear error state if no local dataset exists yet.

## SQLite Import Notes

The import should be staged:

- download files;
- parse extraction date and headers;
- parse rows;
- normalize fuel and service mode;
- reject unsupported fuels;
- reject invalid prices;
- reject map rows with invalid coordinates;
- write into staging tables;
- swap staging data into active tables only after the import succeeds.

Suggested tables:

- `datasets`;
- `stations`;
- `prices`;
- `favorite_places`;
- `favorite_stations`;
- `settings`.

## Open Risks

- Direct on-device import may still be too slow on older phones.
- `dtComu` can be older than the extraction date, so the UI must avoid implying
  that every displayed price was communicated on the dataset date.
- MIMIT file format can change; parser should validate headers before import.
- Coordinates are not guaranteed to be complete or verified.
- There is no confirmed public REST API for nearby stations or per-fuel queries;
  the official daily CSV files are the stable MVP source.
