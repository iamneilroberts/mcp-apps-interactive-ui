# CSP and Imagery

MCP Apps run in sandboxed iframes. The default sandbox is restrictive: no external network access, no external images. This document covers how to declare what your widget needs, where to put the declaration, and a confirmed finding about external imagery support.

## Default Sandbox Restrictions

When `_meta.ui.csp` is omitted entirely, the host applies this CSP:

```
default-src 'none';
script-src  'self' 'unsafe-inline';
style-src   'self' 'unsafe-inline';
img-src     'self' data:;
media-src   'self' data:;
connect-src 'none';
```

Key consequences:

- **External images are blocked.** `<img src="https://...">` silently fails unless you declare `resourceDomains`.
- **External fetch/XHR/WebSocket are blocked.** Declare `connectDomains` for any API calls.
- **Nested iframes are blocked.** Declare `frameDomains` for any embeds (video players, maps, etc.).
- **`window.open` is blocked** by the iframe sandbox regardless of CSP. Use `app.openLink()` instead.
- **`eval` and `new Function()` are blocked.** The SDK sets `z.config({ jitless: true })` automatically to make Zod work under this restriction.

## Declaring What You Need: `_meta.ui.csp`

The type is `McpUiResourceCsp`:

```typescript
interface McpUiResourceCsp {
  /** Origins for fetch/XHR/WebSocket → CSP connect-src */
  connectDomains?: string[];
  /** Origins for images, scripts, styles, fonts, media → CSP img-src, script-src, etc. */
  resourceDomains?: string[];
  /** Origins for nested iframes → CSP frame-src */
  frameDomains?: string[];
  /** Allowed base URIs → CSP base-uri */
  baseUriDomains?: string[];
}
```

Wildcard subdomains are supported: `"https://*.example.com"` covers all subdomains.

The host constructs CSP from your declaration. It may further restrict but must not allow undeclared domains.

## Where to Put the CSP Declaration

Declare CSP in **two places**:

1. **On the resource list entry** (inside `registerAppResource`'s `config` argument): this is the static default the host sees at connection time during prefetch/review.
2. **On the content item** returned by your `resources/read` callback: this is the **authoritative** value. When both are present, the content-item declaration wins.

From `src/server.ts` in this repo:

```typescript
registerAppResource(
  server,
  RESOURCE_URI,
  RESOURCE_URI,
  {
    mimeType: RESOURCE_MIME_TYPE,
    // List-level default: host sees this at connection time
    _meta: { ui: { csp: { resourceDomains: ["https://images.unsplash.com"] } } },
  },
  async (): Promise<ReadResourceResult> => {
    const html = await fs.readFile(path.join(DIST_DIR, "builder.html"), "utf-8");
    return {
      contents: [{
        uri: RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: html,
        // Content-item CSP wins when both are present.
        // Without this, the default sandbox blocks the hero image.
        _meta: { ui: { csp: { resourceDomains: ["https://images.unsplash.com"] } } },
      }],
    };
  },
);
```

## Stable Origin for CORS Allowlisting: `_meta.ui.domain`

If your widget makes authenticated API calls and the API server needs to allowlist a specific CORS origin, use `_meta.ui.domain` to request a stable synthetic origin.

On claude.ai, the format is a hash-derived subdomain of `claudemcpcontent.com`:

```typescript
// Compute a stable origin from your MCP server URL
function computeAppDomainForClaude(mcpServerUrl: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(mcpServerUrl)
    .digest("hex")
    .slice(0, 32);
  return `${hash}.claudemcpcontent.com`;
}

// Then declare it in your resource content item:
_meta: {
  ui: {
    csp: { connectDomains: ["https://api.example.com"] },
    domain: computeAppDomainForClaude("https://your-server.example.com/mcp"),
  }
}
```

The exact format is host-dependent; consult the host's documentation. If `domain` is omitted, the host uses a per-conversation default origin (which may change between sessions).

For APIs that accept `Access-Control-Allow-Origin: *` or API-key auth, you do not need `domain`.

## Confirmed Finding: External Imagery Works on claude.ai

**Both claude.ai web and Claude Desktop honor `resourceDomains` for external `<img>` tags.** This was verified empirically in the `folio-imagery-csp` branch of the Voygent codebase, and is live in the production Folio Board widget.

In the Pizza Builder, declaring `resourceDomains: ["https://images.unsplash.com"]` allows the hero image to load from Unsplash. The widget uses an `onerror` handler to hide the image gracefully if it fails to load:

```html
<img
  src="https://images.unsplash.com/photo-..."
  alt="Pizza"
  onerror="this.style.display='none'"
/>
```

The Voygent Folio Board uses the same pattern for trip hero images served from `*.voygent.ai` R2 storage, declared as `resourceDomains: ["https://*.voygent.ai"]`.

## Permissions

In addition to CSP, you can request browser Permission Policy features via `_meta.ui.permissions`:

```typescript
_meta: {
  ui: {
    permissions: {
      camera: {},
      microphone: {},
      geolocation: {},
      clipboardWrite: {},
    }
  }
}
```

The host MAY grant these by setting the iframe's `allow` attribute. The confirmed capability set on Claude Desktop shows `sandbox: {}` (no permissions granted). Your widget should use JS feature detection as a fallback and never assume permissions are granted.

## Checklist Before Shipping

- [ ] External images → `resourceDomains`
- [ ] Fetch/WebSocket API calls → `connectDomains`
- [ ] Video embeds, maps → `frameDomains`
- [ ] CSP declared in **both** list-level config and content-item `_meta`
- [ ] `onerror` handler on `<img>` tags for graceful degradation
- [ ] `app.openLink()` instead of `window.open()` for external links
- [ ] No `eval` / `new Function()` in widget code (blocked by sandbox)

See [Host API](03-host-api.md) for `openLink` and `downloadFile` usage. See [UI Resources](02-ui-resources.md) for the full `registerAppResource` signature.
