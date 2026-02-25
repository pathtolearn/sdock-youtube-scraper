# YouTube Scraper Actor

Standalone StealthDock Actor for scraping public YouTube metadata from videos, channels, playlists, and search results.

## v1 capabilities

- Input by YouTube URLs or search terms
- Emits normalized dataset records (`source_summary` and `video`)
- Extracts core public metadata (titles, counts, channel info, durations, thumbnails, hashtags)
- Hybrid fetching: HTTP + embedded JSON parsing first, Playwright fallback when needed
- Browser fallback emits runtime telemetry events and includes best-effort consent-wall click handling
- Best-effort pagination/continuation handling for list pages

## v1 limitations

- No subtitle/transcript extraction
- No comments body scraping (count only, when available)
- No dislikes
- No authenticated/private content support
- No CAPTCHA solving (browser fallback handles consent/interstitials best-effort only)

## Local usage

```bash
npm install
npm run test
npm run smoke
```

## Import into StealthDock

1. Push this folder as a public GitHub repository.
2. Import as an actor in StealthDock.
3. Ensure contract files remain at repo root.

## Example output shapes

- `recordType: "source_summary"` for search/channel/playlist/video input sources
- `recordType: "video"` for each discovered or directly requested video

## Notes

- Proxies are strongly recommended for YouTube reliability.
- Scrape only public data and ensure your use complies with applicable laws and platform terms.
