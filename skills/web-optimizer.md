# Skill: web-optimizer (performance, SEO, accessibility)
Run `optimize_audit` on any site you build or modify, fix findings by severity, re-run until no high items remain, then report before/after.
Targets (Core Web Vitals, 75th percentile): LCP <= 2.5s, INP <= 200ms, CLS <= 0.1. JS per route <= 170KB gzip, total page weight <= 1.5MB.
Images: AVIF/WebP, srcset + sizes, explicit width/height, loading="lazy" below the fold, fetchpriority="high" on the LCP image.
Fonts: woff2 only, subset, font-display: swap, preload the one critical font, size-adjust fallback to avoid CLS.
JS: code-split by route, dynamic import for heavy libs (three, charts, editors), tree-shake, remove moment/lodash/jquery, defer third-party scripts, avoid long tasks (> 50ms).
CSS: inline critical CSS, purge unused, avoid layout thrash, animate only transform/opacity, use content-visibility: auto for long pages.
3D/video: Draco/meshopt + KTX2, cap devicePixelRatio at 2, pause offscreen, posters for video, preload="none".
SEO: unique title/description, canonical, Open Graph, structured data, sitemap + robots, semantic headings, lang attribute.
Delivery: long-cache hashed assets, brotli, CDN, preconnect to critical origins, HTTP caching headers.
Verify with Lighthouse CI or PageSpeed Insights where available.
