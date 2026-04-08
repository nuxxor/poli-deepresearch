# Deep Research Workspace

Bu klasor, Polymarket icindeki yeni research-extension urun hattinin kanonik calisma alanidir.

Amac:

- mevcut trade botunu yeniden yazmak degil
- mevcut Polymarket entegrasyonlarini referans almak
- yeni research backend + extension kodunu ayri bir urun hatti olarak izole etmek

## Neden ayri klasor?

Mevcut root kod tabani:

- legacy collector/trading botu
- canli/paper execution scriptleri
- operation runbook'lari

Yeni deep-research urunu ise:

- resolution-aware research
- evidence store
- policy packs
- extension UI
- local-first LLM routing

gerektiriyor. Bu iki akisi fiziksel olarak ayirmak daha temiz.

## Bu repodan reuse edecegimiz seyler

Polymarket'i sifirdan kesfetmeyecegiz. Su mevcut parcalari bilgi ve referans olarak kullanacagiz:

- `polymarket_bot/collectors/market_discovery.py`
  - Gamma market payload'i
  - `conditionId`, `clobTokenIds`, `outcomes`, `question`, `description`
  - mevcut `resolution_source` heuristigi
- `polymarket_bot/collectors/clob_ws.py`
  - market channel subscribe format
  - `book`, `price_change`, `last_trade_price` event handling
- `polymarket_bot/storage/database.py`
  - mevcut market metadata kolonlari
  - `resolution_source`, token ID ve zaman penceresi alanlari
- `scripts/install_polycli_local.sh`
  - resmi `Polymarket/polymarket-cli` release install akisi
- `tools/bin/polymarket`
  - lokal CLI binary
  - read-only bootstrap ve smoke kontrol icin kullanilabilir

## Polymarket CLI'den nasil faydalanacagiz?

CLI'yi trading icin degil, read-only bootstrap ve debug yardimcisi olarak kullanacagiz.

Faydali command aileleri:

- `polymarket markets list|get|search`
- `polymarket events list|get`
- `polymarket tags list|get|related`
- `polymarket sports list`
- `polymarket clob market|book|price-history|midpoint|spread`
- `polymarket data holders|open-interest|volume`

Bu bize uc sey kazandirir:

- official/public API alanlarini hizli teyit etme
- backend adapter yazarken beklenen JSON seklini gozle gorme
- debug sirasinda auth gerektirmeden canli smoke test yapma

## Bugun teyit edilenler

- local binary mevcut: `tools/bin/polymarket`
- local version: `0.1.0`
- `markets list --limit 1 -o json` calisiyor
- `sports list -o json` calisiyor
- `sports list` ciktilarinda `resolution` URL'leri direkt geliyor

Bu son madde kritik:

- sports marketlerinde resmi resolution source cogu durumda Polymarket metadata icinden cikiyor
- yani sports category icin genel web search'i azaltabiliriz

## Klasor icinde planlanan yapi

```text
deep-research/
  README.md
  apps/
    api/
    extension/
  packages/
    contracts/
    market-normalizer/
    policy-packs/
    retrieval/
    extract/
    source-scoring/
    claim-extraction/
    judge/
    monitors/
    evals/
    provider-gateway/
  infra/
    docker/
    migrations/
```

## Canonical spec

Urunun yasayan spesifikasyonu burada:

- `../RESEARCH_EXTENSION_README.md`

Bu klasor pratik ownership ve implementasyon siniri icin acildi.

## Benchmark ciktilari

Provider benchmark kosulari buraya yazilir:

- `benchmarks/provider-benchmark-latest.json`
- `benchmarks/provider-benchmark-*.json`
