# NH Knowledge Updater (Python Edition)

Dette repository indeholder en Python-implementering, der kan bruges direkte i
OpenWebUI som en funktionsudvidelse. Funktionen synkroniserer afgørelser fra
Afgørelsesportalen og gemmer dem i et lokalt vidensarkiv organiseret per nævn.

## Funktioner

- Automatisk download af sitemap(s) fra Afgørelsesportalen.
- Intelligent gruppering per nævn baseret på URL-strukturen.
- Gemmer hver afgørelse som en `.txt`-fil navngivet efter dens GUID.
- Idempotent kørsel: eksisterende filer overskrives ikke.
- Kan bruges som selvstændigt Python-script eller som OpenWebUI-funktion.

## Installation

1. Sørg for at have Python 3.10 eller nyere installeret.
2. Installer afhængigheder:

   ```bash
   pip install -r requirements.txt
   ```

## Brug i OpenWebUI

Importer funktionen `handle_prompt` fra modulet `afgorelsesportalen` og registrér
den som en Python-funktion i OpenWebUI. Når en bruger skriver
"hent alle afgørelser fra afgørelsesportalerne" i en prompt, vil funktionen
køre og opdatere vidensarkivet.

```python
from pathlib import Path
from afgorelsesportalen import handle_prompt

def openwebui_function(prompt: str) -> str:
    return handle_prompt(prompt, archive_root=Path("/path/til/vidensarkiv"))
```

## Direkte brug

```python
from pathlib import Path
from afgorelsesportalen import update_decision_knowledge

summary = update_decision_knowledge(archive_root=Path("knowledge_archive"))
print(summary)
```

## Mappe-struktur

Efter en succesfuld kørsel opbygges arkivet således:

```
knowledge_archive/
└── <Nævnsnavn> afgørelser/
    ├── <GUID>.txt
    └── ...
```

Hver tekstfil indeholder metadata (GUID, nævn, publiceringsdato og kilde-URL)
fulgt af den fulde afgørelsestekst.

## Licens

MIT
