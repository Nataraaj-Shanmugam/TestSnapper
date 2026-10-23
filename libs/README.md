# Bundled libraries

Third-party libraries used for Word and PDF export. They are committed to the
repository and copied into `dist/libs/` by the build. This README is not
included in the build.

| File | Library | Version | Used for | License | Notice |
|---|---|---|---|---|---|
| `docx.min.js` | [docx](https://github.com/dolanmiu/docx) | 7.8.2 | Word (.docx) export | MIT | `docx.min.js.LICENSE.txt` |
| `jspdf.umd.min.js` | [jsPDF](https://github.com/parallax/jsPDF) | 2.5.1 | PDF export | MIT | `jspdf.umd.min.js.LICENSE.txt` |

Both libraries are MIT licensed. The `*.LICENSE.txt` files carry their
copyright and permission notices, which the license requires to ship with the
code, so keep them next to the library files.

## Verifying or restoring the files

```bash
npm run setup-libs
```

`scripts/download-libs.js` checks each file against a pinned SHA-384 hash and
downloads any file that is missing from its pinned source:

- `https://unpkg.com/docx@7.8.2/build/index.js` → `docx.min.js`
- `https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js` → `jspdf.umd.min.js`

The build (`webpack.config.js`) fails if either file is missing.

To upgrade a library, change its URL and hash in `scripts/download-libs.js`,
run `npm run setup-libs`, and update the version and notice file here.

## Line endings

`.gitattributes` marks `libs/*` as `-text` so Git never converts line endings.
A CRLF conversion changes the bytes and breaks the hash check even though the
code is unchanged.

## Loading

Libraries load only from the extension package via `chrome.runtime.getURL()`.
There is no CDN fallback: Manifest V3 forbids remotely hosted code, and the
extension pages use `script-src 'self'`. If a library is missing, that export
format fails with an error instead of fetching anything.
