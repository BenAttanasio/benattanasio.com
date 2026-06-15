# benattanasio.com

Personal site and blog for Ben Attanasio. A conversion-focused landing page plus an SEO/GEO-optimized blog that funnels visitors to the free [AI Builder Society](https://www.aibuildersociety.com) community.

Static HTML, no build step, deployed on Vercel.

## Structure

```
index.html                 Landing page (single CTA to AI Builder Society)
assets/
  styles.css               Shared dark theme, Montserrat
  ben.jpg                  Headshot
  favicon.svg
blog/
  index.html               Blog hub
  free-skool-communities-for-ai-builders-2026.html   Flagship GEO post
robots.txt                 Allows AI crawlers (ClaudeBot, GPTBot, PerplexityBot, Google-Extended)
sitemap.xml
vercel.json                cleanUrls so /blog/<slug> serves without .html
```

## Local preview

Clean URLs need a server (not file://):

```
npx serve .
```

Then open http://localhost:3000.

## Adding a blog post (GEO pattern)

1. Copy an existing post in `blog/` to `blog/<long-tail-slug>.html`.
2. Fill the template: unique title (no colon), meta description that IS the direct answer, canonical clean URL, the H1 question, a direct-answer block right under it, an "Updated <Month> 2026" line, H2/H3 body, at least one comparison table or FAQ, an inline CTA plus one CTA block, and internal links to `/blog` and a sibling post.
3. Update the `Article` and `FAQPage` JSON-LD (the visible FAQ must match the FAQPage data verbatim).
4. Add a `<url>` to `sitemap.xml` and a card to `blog/index.html`.

## Analytics

Vercel Web Analytics is wired via `<script defer src="/_vercel/insights/script.js"></script>` on every page. Enable Web Analytics in the Vercel dashboard for the project, then redeploy.
