# Configuration

Create a `scanldr.json` in your project directory (or in `~/.config/scanldr/scanldr.json` for a global config):

```json
{
  "db_path": "/custom/path/to/scanldr.db"
}
```

## Discovery order

First match wins:

1. `--config <path>` flag.
2. `$SCANLDR_CONFIG` environment variable.
3. `./scanldr.json` in the current working directory.
4. `$XDG_CONFIG_HOME/scanldr/scanldr.json` (falls back to `~/.config/scanldr/scanldr.json`).

## Config keys consumed by production code

| Key | Default | Description |
|-----|---------|-------------|
| `db_path` | `~/.local/share/scanldr/scanldr.db` | Path to the SQLite database file |

All other keys in `DEFAULT_CONFIG` (`preferred_languages`, `download_quality`, `default_format`, `default_out`, `image_concurrency`, `chapter_delay_ms`) are validated and parsed but not read by the walkthrough code path. See [#124](https://github.com/malaquiasdev/scanldr/issues/124).
