# Subject 09 (working title)

A 2D side-scrolling supernatural shooter, loosely inspired by *Carrion*. You play a lab
experiment who escaped containment and fights with powers and stolen gear. Blood, ragdolls,
dismemberment.

**The core move:** grab a guard with your tentacle, harpoon their leg to a wall, then go and
find the scientist and use the prototype laser on them.

This repo is the **gameplay sandbox**: one test chamber with dummies, so the mechanics can be
tuned before any real levels exist.

## Run it

No build step and no dependencies. It's plain HTML5 canvas and JavaScript.

- Double-click `index.html`, or
- serve the folder (for example `npx http-server .`) and open it in a browser.

## Controls

| Input | Action |
|---|---|
| A / D | move |
| W / Space | jump (also leaps off the tentacle) |
| Mouse | aim |
| LMB | fire the current weapon |
| RMB (hold) | tentacle: latch onto walls and reel in, or grab and drag bodies |
| 1 / 2 / Q / mouse wheel | harpoon / prototype laser |
| F | slow motion |
| G / T | spawn a dummy / scientist at the cursor |
| X | clear all harpoons |
| R | reset the chamber |
| H | toggle help |

## What's in the sandbox

- **Verlet ragdolls** (`js/physics.js`, `js/ragdoll.js`): 11 particles with bone and joint-limit
  constraints. NPCs are *active ragdolls*: while conscious they are pulled toward an animated
  pose (standing, waving, walking, fleeing, cowering). When hit, grabbed or killed they go limp,
  and they get back up if they can.
- **Harpoon** (`js/weapons.js`): the spike impales up to 3 body parts, carries them along, and
  pins them into whatever surface it hits. A pinned NPC flails and bleeds.
- **Tentacle grapple**: latch onto terrain and reel in or swing, or hook a body and drag or fling it.
  Pull hard on a pinned body and limbs tear off.
- **Prototype laser**: a continuous beam that burns, dismembers (limbs, decapitation,
  bisection) and overheats.
- **Blood** (`js/blood.js`): droplets splat into a persistent decal layer on walls and floors.
  Severed stumps pump arterial spray.
- **NPCs** (`js/npc.js`): chrome "icon man" test dummies that wave at you, and scientists who
  patrol, panic, flee and cower.
- **Objectives**: pin a guard's leg to a wall, then kill the scientist with the laser.

## Layout

```
index.html      page and title card
js/util.js      math helpers
js/input.js     keyboard and mouse state
js/audio.js     procedural WebAudio sound effects
js/map.js       tile map (ASCII in TEST_MAP), collision, ray casts, pre-rendered art
js/physics.js   Verlet particles and constraints
js/ragdoll.js   skeleton, dismemberment, chrome figure renderer
js/blood.js     blood droplets, decals, and FX (sparks, smoke, text)
js/npc.js       NPC brains and pose-driven active ragdoll
js/weapons.js   harpoon spikes, tentacle, laser constants
js/player.js    the Subject: movement, weapons, puppet rendering
js/game.js      world step, camera, objectives, HUD
js/main.js      boot and fixed-timestep loop
```

To edit the test map, change the ASCII in `TEST_MAP` (`js/map.js`): `#` wall, `=` girder,
`P` player, `G` guard dummy, `S` scientist.
