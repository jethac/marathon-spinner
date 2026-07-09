# Marathon Spinner

**[Live demo → marathon-spinner.jethachan.net](https://marathon-spinner.jethachan.net)**

Reconstruction by **[Jetha Chan](https://x.com/jetha)** (@jetha) driving **[Grok 4.5](https://grok.com)**, of [Abby Welsh](https://x.com/DubThinkDev)’s (@DubThinkDev) procedural loading-spinner shader. Not shipping source.

**Source work:** Abby Welsh (@DubThinkDev)  
**Moth designs:** Wolfie Davis  
**Reconstruction:** Jetha Chan (@jetha) · Grok 4.5  

**Loop:** cocoon → mid (wings) → moth → full noisy center-to-edge wipe (moth design rotates)

> shapes via 2D SDFs · color blend for pixels on/off · per pixel: position + moth + time + noise  
> — [Abby’s breakdown](https://x.com/DubThinkDev/status/2074987002307744255)

## License

[MIT](./LICENSE) © 2026 Jetha Chan

This is an unofficial reconstruction for learning shaders. It is not affiliated with or endorsed by Abby Welsh, Bungie, or related rights holders. Source technique and designs remain theirs; this repo only covers the reconstruction implementation.

## Run locally

```bash
python -m http.server 8765
```

Open `http://localhost:8765/`.

## Layout

| File | Role |
|------|------|
| `index.html` | Preview + sidebar (About / Shader tabs) |
| `styles.css` | UI |
| `main.js` | WebGL host, live compile, transport |
| `shader.frag` | Fragment shader (`iTime`, `iResolution`) |

## Live edit

1. Open the **Shader** tab  
2. Edit GLSL  
3. Auto-recompiles ~0.5s after idle, or **Compile** / `Ctrl+Enter`  
4. Errors keep the last good program running  

## GitHub Pages

Deployed from `main` (root). Custom domain: `marathon-spinner.jethachan.net` (see `CNAME`).

DNS (at your domain host):

| Type  | Name              | Value                 |
|-------|-------------------|-----------------------|
| CNAME | `marathon-spinner` | `jethac.github.io`   |

Then enable Pages → custom domain and HTTPS in the repo settings.
