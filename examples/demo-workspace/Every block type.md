---
tags: [tutorial, reference]
aliases: [Block gallery]
status: reference
---

# Every block type

One page with every kind of block Tessera has. Type `/` on an empty line to add any of them.

## Text

A paragraph is the default block. Text can be **bold**, *italic*, ~~struck through~~, `inline
code`, ==highlighted==, or a [link to the Tessera docs](https://femboypuppy.github.io/Tessera/).

A line can end with a hard break (backslash and Enter),\
so the next line stays in the same paragraph.

Pages link to each other: [[Apollo 11]], [[Neil Armstrong|the first person on the Moon]], or a
heading inside a page: [[Apollo 13#How they got home]]. Tags look like this: #tutorial.

# Heading 1

## Heading 2

### Heading 3

## Lists

- A bulleted list
- with a second item
  - and a nested item
    - nested again

1. A numbered list
2. counts for you
3. and nests too
   1. like this

## To-dos

- [x] Book the exhibit hall
- [x] Choose the Apollo 11 panel photos
- [ ] Record the audio guide
  - [ ] Write the script
  - [ ] Book the studio

## Quote

> The Earth is the cradle of humanity, but mankind cannot stay in the cradle forever.
>
> Konstantin Tsiolkovsky, 1911

## Callouts

> [!note] Note
> A neutral callout, for anything worth setting apart.

> [!info] Info
> Background and context.

> [!tip] Tip
> A helpful suggestion.

> [!success] Success
> Something that worked.

> [!warning] Warning
> Something to be careful about.

> [!danger] Danger
> Something that can go badly wrong.

> [!faq]- A foldable callout
> Click the title to open or close it. It remembers whether it's open.

## Toggle

<details>
<summary>Click to see what's inside</summary>

Toggles hide their contents until you open them. They can hold any blocks, including lists:

- The first stage of a [[Saturn V]] burned for about two and a half minutes.
- It used about 2,000 tonnes of propellant in that time.

</details>

## Code

```ts
// The time for one orbit around Earth, from its altitude (Kepler's third law).
const EARTH_RADIUS_KM = 6371;
const MU = 398_600; // Earth's gravitational parameter, km³/s²

export function orbitalPeriodMinutes(altitudeKm: number): number {
  const a = EARTH_RADIUS_KM + altitudeKm;
  return (2 * Math.PI * Math.sqrt(a ** 3 / MU)) / 60;
}

orbitalPeriodMinutes(400); // ≈ 92.4, the International Space Station
```

```python
# Delta-v of a rocket stage, from the Tsiolkovsky rocket equation.
import math

def delta_v(isp_seconds: float, wet_mass: float, dry_mass: float) -> float:
    g0 = 9.80665
    return isp_seconds * g0 * math.log(wet_mass / dry_mass)
```

```bash
docker compose up -d
```

## Table

| Mission       | Year | Crew | Landed |
| ------------- | ---- | ---- | ------ |
| Apollo 8      | 1968 | 3    | No     |
| Apollo 11     | 1969 | 3    | Yes    |
| Apollo 13     | 1970 | 3    | No     |
| Apollo 17     | 1972 | 3    | Yes    |

## Image

![[hohmann-transfer.png]]

## Embedded database

A database can live inside a page, with its own view. Edit a row here and it changes everywhere:

![[Reading list]]

## Divider

Above the line.

---

Below the line.

Back to [[Welcome to Tessera]].
