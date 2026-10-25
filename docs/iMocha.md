# iMocha — Website & Brand Spec

> Reference for re-skinning WorkVerse so it reads as an iMocha product.
> Researched 2026-10-25 from the live site (`www.imocha.io`), its production CSS bundles, and the product app (`app.imocha.io`).

**How this was built:** Colours, fonts, radii, shadows, gradients and breakpoints were pulled from iMocha's production stylesheets (`imocha.shared.*.min.css`, `imocha.*.opt.min.css`) and from the inline `<style>` blocks on the homepage. Frequency counts come from those files. Logo colours were sampled from the published logo files. Anything marked _(interpreted)_ is a design reading, not a measured value.

---

## 1. Company snapshot

| Item                          | Detail                                                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                          | **iMocha** (formerly _Interview Mocha_)                                                                                                                        |
| Category                      | Skills Intelligence + Work Intelligence platform (enterprise HR tech)                                                                                          |
| Current tagline (homepage H1) | **"The Context Layer for Skills & Work Intelligence"**                                                                                                         |
| Page title                    | "Skills and Work Intelligence Platform \| iMocha"                                                                                                              |
| Meta description              | "iMocha's Skills & Work Intelligence Platform helps enterprises identify skill gaps, upskill teams, improve internal mobility, & make skills-based decisions." |
| Founded                       | 2015 (some sources say 2012 as Interview Mocha)                                                                                                                |
| Founders                      | Amit Mishra (CEO), Sujit Karpe (CTO)                                                                                                                           |
| Registered HQ                 | Claymont, Delaware, USA (engineering roots in India)                                                                                                           |
| Scale claims on site          | "Trusted by 300+ Enterprises", "10,000+ real-world evaluations", "30+ compilers", "50+ global languages", WCAG 2.1 compliant                                   |
| Flagship customer stories     | L'Oréal, PMI (Project Management Institute)                                                                                                                    |
| Key integration partners      | Workday, SAP SuccessFactors, Lightcast (also mentions Oracle)                                                                                                  |
| Website stack                 | **Webflow** (CDN `cdn.prod.website-files.com/6278a259cc3db4179e7a3a8e/`)                                                                                       |
| Product app stack             | ASP.NET, **Bootstrap 4.6.2**, jQuery 3.7.1, Font Awesome 4.7                                                                                                   |

### Product vocabulary (use these words in our UI copy)

- **Skills Intelligence**: Skills Architecture, Skills Inference, Skills Assessment
- **Work Intelligence**
- **Context Layer** (the current main brand idea)
- Use cases: **Skill Gap Analysis**, **Upskilling & Reskilling**, **Internal Mobility**, **Strategic Workforce Planning**, **Skills-based Hiring**, **AI-Readiness (Index)**
- Assessment products: **AI-LogicBox**, **AI-EnglishPro**, **Smart Proctoring Suite**, **Conversational AI Interviews**, Coding Assessments
- Recurring phrases: "skills-first", "future-ready workforce", "skills-first enterprise", "purpose-built agents", "one defensible view of the workforce", "Hire for skills, not just resumes"

---

## 2. Logo & icon

### 2.1 Assets (official URLs)

| Asset                           | URL                                                                                                            | Notes                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Primary logo (colour, on light) | `https://cdn.prod.website-files.com/6278a259cc3db4179e7a3a8e/654b29875b7b00835efdede8_imocha%20logo.webp`      | 235×51, used in the top nav (`.main-nav-logo`)             |
| White logo (SVG, on dark)       | `https://cdn.prod.website-files.com/6278a259cc3db4179e7a3a8e/639c71cbd865df7e89189da5_iMocha%20white.svg`      | viewBox `0 0 235 51`, used in the footer at `height: 2rem` |
| Favicon (32×32 PNG)             | `https://cdn.prod.website-files.com/6278a259cc3db4179e7a3a8e/686168f73ddf6f415413b775_iMocha-favicon.png`      | `rel="shortcut icon"`                                      |
| Apple touch icon (256×256)      | `https://cdn.prod.website-files.com/6278a259cc3db4179e7a3a8e/62ee6892639ba1cb566cf061_256333.png`              | Mark only, orange                                          |
| OG / social image               | `https://cdn.prod.website-files.com/6278a259cc3db4179e7a3a8e/64e8684b946301eb2f78a218_Frame%204188%20(1).webp` |                                                            |
| App favicon                     | `https://app.imocha.io/Content/images/imocha-logo/imocha-favicon.png`                                          |                                                            |

### 2.2 Anatomy

```
 [ mark ]  iMocha
  orange   dark-purple wordmark
```

- **Mark ("the ring"):** a circle split into **four rounded quarter-arc segments** with gaps between them (like a lifebuoy cut into 4 pieces). In the **top-right segment**, a **solid circle (a dot)** sits over the ring and cuts into it. Read it as a target or focus point: the one skill that matters.
- **Mark colour:** `#FD5B0E` (Orange-Red), flat with no gradient. It is the only colour in the icon.
- **Wordmark:** "iMocha" in a heavy geometric sans with a lowercase **i** and a capital **M**. Colour **`#220032`** (Dark Purple). Always write it as `iMocha`, never "IMocha" or "Imocha".
- **On dark backgrounds:** use the white SVG (mark and wordmark both white).
- **Proportions:** 235:51 (≈ 4.6:1). The mark is about 51×51 and sits on the left.
- **Minimum use observed:** 32px tall in the footer, ≈ 40px in the nav.

### 2.3 Rules for WorkVerse _(interpreted)_

- Favicon: use the orange ring-mark alone.
- Do not recolour the mark. Do not put the orange mark on an orange background; switch to the white version.
- Co-branding ("WorkVerse by iMocha" or "Powered by iMocha"): put the iMocha logo first or in a lock-up with a thin `#2B273833` divider.

---

## 3. Colour system

### 3.1 Official tokens (declared as CSS variables in the Webflow bundle)

| Token (iMocha name)     | Hex           | Role                                                                                            |
| ----------------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| `--orange-red`          | **`#FD5B0E`** | **Primary brand / CTA colour.** Buttons, logo mark, highlights, active states. Used 30× in CSS. |
| `--main-imocha-blue`    | **`#491AEB`** | Secondary brand: electric violet-blue. Gradient start, links, accents.                          |
| `--dark-purple-imocha`  | **`#220032`** | Deep aubergine. Logo wordmark, dark sections, nav link text, dark cards.                        |
| `--imocha-black`        | **`#1E1925`** | Default body text colour (a purple-tinted near-black, not pure black).                          |
| `--true-black-202020`   | `#202020`     | Neutral near-black.                                                                             |
| `--imocha-light-blue`   | **`#F1F5F9`** | **Default page background** (`body` background).                                                |
| `--imocha-light-purple` | **`#F4F3FA`** | Alternate section / CTA band background (`.cta-lightpurple`).                                   |
| `--aquamarine`          | `#C5FFDC`     | Rare success/fresh accent.                                                                      |
| `--white`               | `#FFFFFF`     | Cards, nav bar, surfaces.                                                                       |

### 3.2 Supporting colours (measured, from frequency in CSS)

| Hex                           | Uses   | Role                                                          |
| ----------------------------- | ------ | ------------------------------------------------------------- |
| `#FF7F42`                     | 8      | Light orange, end stop of the orange gradient, hover          |
| `#FFB47C`                     | 6      | Peach glow, used in radial "blob" backgrounds                 |
| `#FF5C0C`                     | 2      | Orange variant used in glows (at 10–20% alpha)                |
| `#FFF6F0`                     | 2      | **Orange tint**: secondary-button background, soft highlights |
| `#C84710`                     | —      | **Deep orange**: text colour on the tinted secondary button   |
| `#0A0A0A`                     | 10     | **Footer background**                                         |
| `#141414`                     | —      | Footer social-icon chip                                       |
| `#121116`                     | —      | Dark card surface (Skills/Work panels)                        |
| `#F2F2F2`                     | —      | Footer text                                                   |
| `#9A9A9A`                     | —      | Footer muted text                                             |
| `#FAFAFA` / `#F8F8F8`         | 13 / 9 | Light neutral surfaces                                        |
| `#E8E9F1`                     | 3      | Cool divider / gradient start                                 |
| `#2B2738` @ 20% (`#2B273833`) | —      | Hairline border on tags/chips                                 |
| `#5B8DEF`                     | —      | Focus ring (footer `:focus-visible`)                          |
| `#FE9D6E`                     | —      | "Skills" accent text on dark (light orange)                   |
| `#C4A8FF` / `#A77BFF`         | —      | "Work" accent text on dark (lavender)                         |
| `#F6F2FA`                     | —      | Ink colour on dark panels                                     |
| `#B3AAC3`                     | —      | Muted text on dark panels                                     |
| `#000000A6` (black @ 65%)     | —      | Hero subtext                                                  |

### 3.3 Colour pairing rule: "Skills = Orange, Work = Violet"

The homepage pairs the two halves of the platform with the two brand hues:

- **Skills Intelligence → orange** (`#FD5B0E`, tint `rgba(253,91,14,.1)`, border `rgba(253,91,14,.32)`, text `#FE9D6E` on dark)
- **Work Intelligence → violet** (`#A77BFF`, tint `rgba(167,123,255,.1)`, border `rgba(167,123,255,.36)`, text `#C4A8FF` on dark)

WorkVerse should follow this: **orange for skills, assessment, scores and learner progress; violet for work, simulations, scenarios and the AI agents.**

### 3.4 Product app palette (`app.imocha.io`, Bootstrap-based)

The product app is older and more conventional than the marketing site:

| Hex                                        | Uses   | Role                                      |
| ------------------------------------------ | ------ | ----------------------------------------- |
| `#135DCB`                                  | 22     | App primary blue (links, primary actions) |
| `#08165B`                                  | 19     | Navy (headers, sidebar)                   |
| `#384C61`                                  | 22     | Slate text                                |
| `#424C58`                                  | 12     | Secondary text                            |
| `#ED6900`                                  | 20     | App orange (CTAs)                         |
| `#FF6C4A`                                  | 12     | Coral accent                              |
| `#0099FF` / `#487FF7`                      | 11 / 8 | Info blues                                |
| `#E5E9F0`, `#F2F3F6`, `#F5F6F9`, `#F8F8FA` | —      | Panel and background greys                |

> **Recommendation:** Copy the **marketing-site palette (3.1)**, not the app palette. It is the current brand (2025–26 refresh) and looks more modern, and judges will compare against imocha.io.

### 3.5 Signature gradients

| Name                                 | CSS                                                                                                                              | Where used                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Brand gradient** (violet → orange) | `linear-gradient(103deg, #491AEB, #FD5B0E)`                                                                                      | **Gradient headline text** (`background-clip:text`), accent bars. Also seen at `90deg` and `100deg`. |
| **Orange button gradient**           | `linear-gradient(135deg, #FD5B0E, #FF7F42)`                                                                                      | Primary CTA fills (7 uses)                                                                           |
| Dark purple corner glow              | `radial-gradient(circle at 100% 0, #220032 25%, transparent)`                                                                    | Dark hero/CTA corners                                                                                |
| Peach corner blob                    | `radial-gradient(circle at 0 100%, #FFB47C, transparent 40%)`                                                                    | Light section corners                                                                                |
| Orange whisper                       | `radial-gradient(circle farthest-side at 100% 0, #FF7B3A21, transparent 13%)`                                                    | Subtle top-right warm glow                                                                           |
| Violet spotlight                     | `radial-gradient(circle at 50% 0, #491AEB, transparent)`                                                                         | Dark sections with a spotlight from the top                                                          |
| Soft lavender                        | `radial-gradient(circle farthest-side at 0 0, #F4F9FF, #C9C6EA 52%)`                                                             | Light card backgrounds                                                                               |
| Cool fade                            | `linear-gradient(#E8E9F1, #DFE2FD00)`                                                                                            | Section top fades                                                                                    |
| Orange tint fade                     | `radial-gradient(circle at 0%, #FFF6F0, #FFF)`                                                                                   | Warm white cards                                                                                     |
| Mint + orange duo                    | `radial-gradient(circle at 100% 100%, #55FF991A, transparent 30%), radial-gradient(circle at 0%, #FF5C0C1A 6%, transparent 36%)` | Feature cards                                                                                        |

**Gradient headline recipe** (iMocha uses this on key words in H1/H2):

```css
.text-brand-gradient {
  background-image: linear-gradient(103deg, #491aeb, #fd5b0e);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

---

## 4. Typography

### 4.1 Families

| Family                                    | Role                                                                                                      | Source                     |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------- |
| **Playfair Display** (400, sometimes 500) | **All headings H1–H5.** An elegant high-contrast serif and the most recognisable part of the brand voice. | Google Fonts               |
| **Poppins** (300 / 400 / 500 / 600)       | **Body, UI, nav, buttons, labels.** Used 72× in CSS.                                                      | Google Fonts + self-hosted |
| Inter (100–900)                           | Loaded by WebFont.load. Minor or legacy use.                                                              | Google Fonts               |
| DM Sans                                   | Minor (3 uses)                                                                                            | —                          |
| "Wulkan Display"                          | Rare display face (2 uses)                                                                                | Custom                     |

Google Fonts link used on the site:

```html
<link
  href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500&family=Poppins:wght@300;400;500;600&display=swap"
  rel="stylesheet"
/>
```

Serif fallback stack used: `"Playfair Display", Georgia, "Times New Roman", serif`
Sans fallback stack: `Poppins, "Segoe UI", system-ui, sans-serif`

> **Key look:** serif headlines in **regular weight (400)**, not bold, with geometric sans body text. This editorial serif-plus-geometric-sans pairing is what makes iMocha look premium and unlike typical SaaS. Keep headlines at 400 to match.

### 4.2 Type scale (measured from base element styles)

| Element                  | Family           | Size                           | Weight  | Line-height              |
| ------------------------ | ---------------- | ------------------------------ | ------- | ------------------------ |
| `body`                   | Poppins          | 16px                           | 400     | 1.27                     |
| `h1`                     | Playfair Display | **45px**                       | **400** | 49.5px (1.1)             |
| `h2`                     | Playfair Display | 32px (22px on mobile)          | 500     | 41.6px (1.3)             |
| `h3`                     | Playfair Display | ~24–26px (`1.625rem` on cards) | 400     | 1.2                      |
| `h4`                     | Playfair Display | 22px                           | 500     | 30px                     |
| `h5`                     | Playfair Display | 20px                           | 500     | 34px                     |
| `h6`                     | Poppins          | 16px                           | 500     | 28px                     |
| Hero subtext             | Poppins          | 20px                           | 400     | colour `rgba(0,0,0,.65)` |
| Lead / gradient sub-line | Poppins          | 18px                           | 500     | 1.5                      |
| Nav link                 | Poppins          | 16px                           | 400–500 | —                        |
| Button                   | Poppins          | 18px                           | 400–500 | 21px                     |
| Tag / chip               | Poppins          | 14px                           | 500     | —                        |
| Card description         | Poppins          | 15px (`.9375rem`)              | 400     | 1.55                     |
| Footer body              | Poppins          | 15px                           | 400     | 1.5                      |
| Footer heading           | Poppins          | 14px                           | **600** | 1.3                      |
| Footer description       | Poppins          | 14px                           | 400     | 1.7                      |

Rendering: `-webkit-font-smoothing: antialiased` on the dark components.

---

## 5. Layout, spacing & grid

| Property                 | Value                                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Page background          | `#F1F5F9` (light blue-grey); sections alternate with `#FFFFFF` and `#F4F3FA`                                                                 |
| Max content width        | **`87.5rem` (1400px)** (footer container)                                                                                                    |
| Container side padding   | `2.5rem` (40px) desktop; nav uses `50px`                                                                                                     |
| Section vertical padding | **88px** top/bottom (`.section`); secondary sections 64px; CTA bands 60px                                                                    |
| Fixed nav offset         | Hero `padding-top` 110–140px; hero `min-height: 100svh`                                                                                      |
| Common gaps              | 20px (button groups), 55px (CTA block), 64px (footer column gap), 3.5rem rows                                                                |
| Grid style               | CSS grid / flex. Footer is `20rem` brand column + `1fr` link grid. Skills/Work comparison is `1fr 16rem 1fr` (two cards with a central hub). |

### Breakpoints (Webflow standard)

| Name             | Query                                   |
| ---------------- | --------------------------------------- |
| Tablet           | `max-width: 991px`                      |
| Mobile landscape | `max-width: 767px`                      |
| Mobile portrait  | `max-width: 479px`                      |
| Large desktop    | `min-width: 1280px`, `1440px`, `1920px` |

---

## 6. Shape, elevation & motion

### Border radius (by frequency)

| Radius   | Uses | Applied to                                         |
| -------- | ---- | -------------------------------------------------- |
| **12px** | 39   | **Default card radius**                            |
| 6px      | 27   | Primary buttons, nav items, icon tiles (`.375rem`) |
| 8px      | 20   | Tags/chips, nav links, panel cards (`.5rem`)       |
| 24px     | 20   | Large feature cards, media                         |
| 50px     | 4    | **Pill** secondary buttons                         |
| 50%      | —    | Avatars, social icons                              |

### Shadows

| Token _(interpreted)_ | Value                                            | Use                                            |
| --------------------- | ------------------------------------------------ | ---------------------------------------------- |
| nav                   | `0 0 20px 4px #1E19250D`                         | Fixed white nav bar (very soft, purple-tinted) |
| card-sm               | `0 2px 8px #0000001F`                            | Cards                                          |
| card-xs               | `2px 2px 8px #00000014`                          | Tiles                                          |
| chip                  | `-1px 1px 8px #00000014`                         | Tags                                           |
| **cta-glow**          | `0 0 40px #FFFFFF33, 0 2px 8px #00000033`        | Orange primary button (white halo)             |
| cta-ghost             | `inset 0 2px 5px #FD5B0E33, 0 2px 8px #00000033` | Translucent button on dark                     |
| dark-tile             | `0 .375rem 1rem rgba(0,0,0,.35)`                 | White logo tiles on dark                       |

### Borders

- Hairlines on light: `1px solid #2B273833`
- Hairlines on dark: `1px solid rgba(255,255,255,.08)` (sometimes `.07` / `.1`)

### Motion

- Buttons: `transition: all .2s` (primary) or `background-color .4s, opacity .4s, color .4s` (pill)
- Footer links: `160ms ease`
- Text/hover reveals: `.32s`
- Logo marquee: continuous horizontal scroll, draggable, with edge fade masks (`mask-image` linear-gradient, fade 90px desktop to 24px mobile, gap 64px to 32px)
- Lottie animations in CTA blocks (360×360)
- Card hover: cursor-tracked radial glow using CSS vars `--mx/--my` _(on the dark Skills/Work panels)_

---

## 7. Components

### 7.1 Navigation bar

- **Fixed** to the top (`position: fixed; inset: 0 0 auto`), white background, soft shadow `0 0 20px 4px #1E19250D`, very high z-index.
- Layout: logo on the left, mega-menu dropdowns in the centre, actions on the right.
- Menu items: **Products · Use Cases · Customers · Resources · Company**. On the right: **Login** (text link) and **Book a Demo** (orange button).
- Link style: colour `#220032`, 16px, `padding: 12px`, `border-radius: 8px`, transparent 1px border (shows on hover).
- **Mega-menus**: grouped columns, each item with a **title + one-line description**. Some have a **featured promo card** on the right (e.g. "L'Oréal Fast-Tracks Skills Transformation with iMocha… Learn more"; "Why Microsoft's CEO, Satya Nadella, called us Innovative"). Integration partner logos (Workday, SAP, Lightcast) appear inside the Products menu.

### 7.2 Buttons

**Primary (solid orange)** — "Book a Demo", "Talk to an Expert"

```css
.btn-primary {
  color: #fff;
  background: #fd5b0e; /* or linear-gradient(135deg,#FD5B0E,#FF7F42) */
  border: 0;
  border-radius: 6px; /* nav version uses 2px */
  padding: 12px 24px;
  font:
    400 18px/21px Poppins,
    sans-serif;
  box-shadow:
    0 0 40px #ffffff33,
    0 2px 8px #00000033;
  transition: all 0.2s;
}
```

**Secondary (tinted pill)**

```css
.btn-tint {
  color: #c84710;
  background: #fff6f0;
  border-radius: 50px;
  padding: 10px 19px;
  transition:
    background-color 0.4s,
    opacity 0.4s,
    color 0.4s;
}
```

**Ghost on dark**

```css
.btn-ghost-dark {
  color: #fff;
  background: rgba(64, 64, 64, 0.2);
  border-radius: 6px;
  padding: 12px 24px;
  box-shadow:
    inset 0 2px 5px #fd5b0e33,
    0 2px 8px #00000033;
}
```

CTA copy used: **"Book a Demo"**, **"Talk to an Expert"**, "Learn more", "View all". Under hero CTAs there is trust micro-copy (15px, line-height 1.5), e.g. "Trusted by global enterprises to power skills-first workforce strategy".

### 7.3 Tags / chips / eyebrows

- Eyebrow above the H1: small label, e.g. "Skills and Work Intelligence", "CUSTOMIZED PRODUCT DEMO".
- Chip: white background, `1px solid #2B273833`, `border-radius: 8px`, `padding: 8px 16px`, shadow `-1px 1px 8px #00000014`, 14px / 500.

### 7.4 Cards

- **Light card:** white, `border-radius: 12px` (large ones 24px), shadow `0 2px 8px #0000001F`, optional warm radial tint in one corner.
- **Dark panel card** (Skills/Work section): background `#121116` with `linear-gradient(180deg, rgba(255,255,255,.045), transparent 40%)`, border `1px solid rgba(255,255,255,.08)`, radius 8px. Header row has a **3rem icon tile** (radius 6px, tinted orange or violet with a matching 35% border), a **Playfair title at 26px/400**, and a muted description `#B3AAC3`.
- **Use-case card:** H3 headline in Playfair plus a short Poppins description and an illustration/screenshot.
- **Testimonial / case-study card:** customer logo, H3 story title ("How PMI Built a Skills-First…"), link out.

### 7.5 Logo marquee ("Trusted by…")

Greyscale/colour customer logos in an infinite, draggable horizontal scroll with fade masks on both edges. Logo height is about 40px (`.hero_logos`).

### 7.6 FAQ accordion

- H2 "Frequently Asked Questions"
- Questions numbered **"Q1. … Q20."** as H3s, in an expand/collapse list.
- Questions are long and SEO-focused, written from the buyer's side ("How do I identify skill gaps across my entire workforce without relying on employee self-assessments?").

### 7.7 CTA band

- Full-width band with `cta_bg.webp` (a soft gradient image) or `#F4F3FA`, padding `80px 50px 90px`, centred serif headline, button group (gap 20px), optional Lottie illustration.
- Example: "Unlock Your Workforce Potential", "Transform your hiring and upskilling strategy with trusted, AI-powered skills validation."

### 7.8 Footer

- Background **`#0A0A0A`**, text `#F2F2F2`, Poppins 15px.
- Container 1400px, padding 4rem vertical.
- **Left brand column (20rem):** white SVG logo (2rem tall), description (`#9A9A9A`, 14px, lh 1.7), circular social icons (2.5rem, `#141414` bg, `rgba(255,255,255,.1)` border; on hover the border turns `rgba(91,141,239,.6)`), then a **"Security & compliance"** list of certification seals (ISO, SOC 2, GDPR style, 2.25rem round seals with hairline separators).
- **Right link grid:** columns **Product · Use cases · Company · Resources · Recognitions · Integrations**. Headings 14px/600.
- Bottom legal nav row (Privacy, Terms, etc.).
- Built with BEM classes (`.imf-footer__*`), no JS, rem units.

---

## 8. Information architecture

### 8.1 Site map (from the nav and footer)

```
imocha.io
├── Products
│   ├── Skills Intelligence
│   │   ├── Skills Architecture   – "Maintain a dynamic & role-aligned organizational skills architecture."
│   │   ├── Skills Inference      – "AI-driven Skills Inference automates and updates employee skill profiles"
│   │   └── Skills Assessment     – "Validate candidate's skills with 10,000+ real-world evaluations."
│   ├── Work Intelligence
│   └── Key Integration Partners: Workday · SAP SuccessFactors · Lightcast · (View all)
├── Use Cases
│   ├── Skill Gap Analysis             – "Uncover the gaps. Build a future-ready workforce."
│   ├── Upskilling & Reskilling        – "Fuel Smarter Learning Journeys with Data-Backed Skills Insights."
│   ├── Internal Mobility              – "Accelerate career growth. Unlock internal potential."
│   ├── Strategic Workforce Planning   – "Plan your future workforce - one skill at a time."
│   ├── Skills-based Hiring            – "Hire smarter, faster - with skills at the core."
│   └── AI-Readiness                   – "AI-Readiness Index replaces self-reported confidence with performance-based evidence"
├── Customers
├── Resources: Skills Assessment Library · Blogs · Whitepapers & Guides · Podcasts & Webinars · Events
├── Company: About Us · Leadership & Advisory · Partners · Contact Us · Careers · Newsroom
├── Login  → app.imocha.io
└── Book a Demo → /schedule-a-demo
```

### 8.2 Homepage section order (top to bottom)

| #   | Section class               | Content                                                                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `section_home-hero`         | Eyebrow "Skills and Work Intelligence", H1 **"The Context Layer for Skills & Work Intelligence"**, sub "Transform fragmented talent data into real-time, actionable context for smarter decisions and AI-driven execution.", CTA **Talk to an Expert**, trust line + logo marquee. Full-viewport hero with an abstract background image.                      |
| 2   | `section_home-proof`        | H2 "Look Beyond the Label"                                                                                                                                                                                                                                                                                                                                    |
| 3   | `section_home-analysts`     | H2 "Leader in Skills Intelligence, The Analysts Have Ranked Us" (analyst badges/reports)                                                                                                                                                                                                                                                                      |
| 4   | `section_home-intelligence` | H2 "Two Intelligences, One Defensible View of the Workforce". Two H3 panels: _What is Work Intelligence?_ / _What is Skills Intelligence?_ (dark orange-vs-violet cards with a central hub)                                                                                                                                                                   |
| 5   | `section_home-use-cases`    | H2 "Every Talent Decision That Matters". Five use-case cards (skill gaps, learning journeys, career growth, workforce planning, skills-based hiring)                                                                                                                                                                                                          |
| 6   | `section_home-integrations` | H2 "The Context Layer, Connected to Your Tech Ecosystem"                                                                                                                                                                                                                                                                                                      |
| 7   | `section_home-platform`     | H2 "The Unified System: Skills & Work Intelligence". Diagram: Skills Intelligence, Context Layer, Work Intelligence                                                                                                                                                                                                                                           |
| 8   | `section_home-testimonials` | H2 "Trusted by 300+ Enterprises". PMI and L'Oréal stories                                                                                                                                                                                                                                                                                                     |
| 9   | `section_home-agents`       | H2 "Meet the Purpose-built Agents Behind the Intelligence"                                                                                                                                                                                                                                                                                                    |
| 10  | `section_home-why`          | H2 "One Platform, Built for Skills-First Enterprises". Eight feature tiles: Unified Skills Intelligence Layer · AI-Powered Inference & Validation · Continuously Accurate Skills Profiles · Enriched Taxonomies & Ontologies · Closed-Loop Skills System · Seamless HR Tech Integration · Actionable Skills Analytics · Built for Skills-First Transformation |
| 11  | `section_home-faq`          | CTA "Unlock Your Workforce Potential", then "Frequently Asked Questions" Q1–Q20                                                                                                                                                                                                                                                                               |
| 12  | `footer`                    | Dark footer (see 7.8)                                                                                                                                                                                                                                                                                                                                         |

### 8.3 Product page pattern (Skills Assessment page)

Hero H1 ("Validate Skills with AI-powered Precision and Global Scalability"), problem statement H2, then alternating feature blocks (Assessment Library, Coding with 30+ compilers, AI-LogicBox, AI-EnglishPro, Smart Proctoring, Interview Solutions, Conversational AI Interviews, 50+ languages / WCAG), then "What Makes iMocha Different?", customer stories, CTA band, FAQ, footer.

### 8.4 Demo page pattern

Eyebrow "CUSTOMIZED PRODUCT DEMO", H1 "Experience iMocha in Action", form, testimonials, footer.

---

## 9. Imagery & illustration style _(interpreted)_

- **Abstract gradient backgrounds** (hero `Hero_home_bg.avif`, `cta_bg.webp`): soft orange/peach and violet glows on light or dark-purple bases. No harsh stock photos in key sections.
- **Product UI screenshots** in rounded frames (10–24px radius) showing dashboards, skill profiles and heatmaps.
- **Lottie animations** for CTAs.
- **Line/vector decoration** (`Lines.webp`, `Vector.webp`) repeated along hero edges.
- **Logos on white tiles** over dark panels.
- Photos (when used) get a dark purple overlay: `linear-gradient(#2200324D, #2200324D)` plus `radial-gradient(#22003280, transparent)`.
- Icons: outlined, single-colour, about 24px, inside tinted square tiles.

---

## 10. Voice & tone

- **Enterprise, confident, outcome-led.** Talks to CHROs, L&D heads, HRBPs and talent-acquisition leaders.
- Headline formulas:
  - Contrast: "Hire for Skills, Not Just Resumes", "Look Beyond the Label"
  - Pairing: "Two Intelligences, One Defensible View of the Workforce"
  - Big claim: "The Context Layer for…", "Every Talent Decision That Matters"
- Sub-copy uses verb-first fragments: "Uncover the gaps. Build a future-ready workforce."
- Title Case for headlines and nav; sentence case for descriptions.
- Proof everywhere: numbers (300+, 10,000+, 30+, 50+), analyst rankings, Fortune-500 logos, named case studies.

---

## 11. Drop-in tokens for WorkVerse

### 11.1 CSS variables

```css
:root {
  /* Brand */
  --im-orange: #fd5b0e; /* primary / CTA */
  --im-orange-light: #ff7f42;
  --im-orange-deep: #c84710; /* text on orange tint */
  --im-orange-tint: #fff6f0;
  --im-peach: #ffb47c;
  --im-violet: #491aeb; /* secondary brand */
  --im-lavender: #a77bff; /* "work" accent on dark */
  --im-lavender-text: #c4a8ff;
  --im-purple-dark: #220032; /* logo wordmark, dark sections */
  --im-aquamarine: #c5ffdc;

  /* Neutrals */
  --im-ink: #1e1925; /* body text */
  --im-ink-muted: rgba(0, 0, 0, 0.65);
  --im-bg: #f1f5f9; /* page */
  --im-bg-alt: #f4f3fa; /* alt band */
  --im-surface: #ffffff;
  --im-border: #2b273833;
  --im-footer: #0a0a0a;
  --im-dark-card: #121116;
  --im-dark-ink: #f6f2fa;
  --im-dark-muted: #b3aac3;
  --im-dark-line: rgba(255, 255, 255, 0.08);
  --im-focus: #5b8def;

  /* Gradients */
  --im-grad-brand: linear-gradient(103deg, #491aeb, #fd5b0e);
  --im-grad-cta: linear-gradient(135deg, #fd5b0e, #ff7f42);

  /* Type */
  --im-font-serif: "Playfair Display", Georgia, "Times New Roman", serif;
  --im-font-sans: Poppins, "Segoe UI", system-ui, sans-serif;

  /* Shape */
  --im-radius-sm: 6px;
  --im-radius-md: 8px;
  --im-radius-lg: 12px;
  --im-radius-xl: 24px;
  --im-radius-pill: 50px;

  /* Elevation */
  --im-shadow-nav: 0 0 20px 4px #1e19250d;
  --im-shadow-card: 0 2px 8px #0000001f;
  --im-shadow-cta: 0 0 40px #ffffff33, 0 2px 8px #00000033;
}
```

### 11.2 Tailwind `theme.extend` snippet

```js
colors: {
  imocha: {
    orange: { DEFAULT: '#FD5B0E', light: '#FF7F42', deep: '#C84710', tint: '#FFF6F0', peach: '#FFB47C' },
    violet: { DEFAULT: '#491AEB', lavender: '#A77BFF', text: '#C4A8FF' },
    purple: { dark: '#220032' },
    ink:    { DEFAULT: '#1E1925' },
    bg:     { DEFAULT: '#F1F5F9', alt: '#F4F3FA' },
    dark:   { footer: '#0A0A0A', card: '#121116', ink: '#F6F2FA', muted: '#B3AAC3' },
    aqua:   '#C5FFDC',
  },
},
fontFamily: {
  serif: ['"Playfair Display"', 'Georgia', 'serif'],
  sans:  ['Poppins', '"Segoe UI"', 'system-ui', 'sans-serif'],
},
borderRadius: { im: '12px', 'im-sm': '6px', 'im-md': '8px', 'im-xl': '24px' },
boxShadow: {
  'im-nav':  '0 0 20px 4px #1E19250D',
  'im-card': '0 2px 8px #0000001F',
  'im-cta':  '0 0 40px #FFFFFF33, 0 2px 8px #00000033',
},
backgroundImage: {
  'im-brand': 'linear-gradient(103deg, #491AEB, #FD5B0E)',
  'im-cta':   'linear-gradient(135deg, #FD5B0E, #FF7F42)',
},
```

### 11.3 Checklist to make WorkVerse look like iMocha

1. Page background `#F1F5F9`, white cards with 12px radius and soft shadow.
2. **All headings in Playfair Display 400**; everything else in Poppins.
3. One primary action per view in **solid orange `#FD5B0E`**, 6px radius. Secondary actions as an orange-tint pill.
4. Gradient text (violet → orange) on **one key phrase** per hero, not more.
5. Fixed white top nav with the iMocha logo on the left and "Book a Demo"-style orange CTA on the right; nav text `#220032`.
6. Dark sections and the footer use `#0A0A0A` / `#121116` / `#220032` with orange and violet glows.
7. **Orange = skills/assessment, violet = work/simulation/agents.**
8. Use iMocha vocabulary: _Skills Intelligence, Skills Profile, Skill Gap, AI-Readiness, Context Layer, skills-first_.
9. Add proof elements: certification badges, "Trusted by 300+ enterprises", Workday / SAP SuccessFactors integration badges.
10. Favicon = orange ring mark; tab title format `"<Page> | iMocha"` or `"WorkVerse | iMocha"`.

---

## 12. Sources

- https://www.imocha.io/ (homepage HTML + CSS bundles)
- https://www.imocha.io/products/skills-assessment
- https://www.imocha.io/schedule-a-demo
- https://www.imocha.io/blog
- https://app.imocha.io/ (login shell, `Content/style.css`)
- Company facts: [Datanyze](https://www.datanyze.com/companies/imocha/1297395742), [CB Insights](https://www.cbinsights.com/company/interview-mocha), [Dealroom](https://app.dealroom.co/companies/interview_mocha), [yespress.io](https://yespress.io/imocha.md)
