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
| G / T | spawn a guard / scientist at the cursor |
| X | clear all harpoons |
| R | reset the chamber |
| H | toggle help |

## What's in the sandbox

- **Pixel art rendering** (`js/render.js`): the game renders at about 270 vertical pixels into a
  software framebuffer, then is upscaled by a whole-number factor with no smoothing. The HUD
  uses a built-in 3x5 pixel font.
- **Pixel-perfect bodies** (`js/ragdoll.js`): each body part (head, torso, upper and lower arms
  and legs) is a small pixel bitmap on a two-particle Verlet bone. Every pixel has an outer
  colour (skin, uniform or coat) and an inner one (flesh, bone, brain).
  - The **laser burns away the exact pixels it touches**. Cut edges turn into charred flesh
    and bone, and bleed.
  - After each burn the piece is flood-filled. If it has split into separate islands, each
    island becomes its own physics body. Any part can be cut off at any pixel: a limb
    mid-bone, a diagonal slice through the torso, even a sliver down the length of a shin.
  - **Blood drops stain the exact pixel they land on**, on bodies (including yours) and on the
    walls and floor.
- **Active ragdolls**: while conscious, NPCs are pulled toward an animated pose (idle wave,
  walk, flee, cower). When hit, grabbed, pinned or killed they go limp, and they get back up if
  their legs are still attached. Losing the connection between the head and the pelvis kills them.
- **Harpoon** (`js/weapons.js`): impales up to 3 body parts (pixel-precise hits), carries them,
  and pins them into whatever surface it hits. A pinned NPC flails and bleeds.
- **Tentacle grapple**: latch onto terrain to reel in or swing, or hook a body to drag or fling
  it. Pull hard on a pinned body and limbs tear off at the joint.
- **NPCs** (`js/npc.js`): side-view stick-figure characters. Security guards (helmet, visor,
  uniform) wave at you. Scientists (lab coat, goggles) patrol, panic, flee and cower.
- **Objectives**: pin a guard's leg to a wall, then kill the scientist with the laser.

## Layout

```
index.html      page and title card
js/util.js      math helpers
js/input.js     keyboard and mouse state
js/audio.js     procedural WebAudio sound effects
js/render.js    colours, pixel framebuffer, 3x5 pixel font
js/map.js       tile map (ASCII in TEST_MAP), collision, ray casts, pixel-art tileset
js/physics.js   Verlet particles and constraints
js/ragdoll.js   pixel body pieces: sprite generation, burning, splitting, bleeding
js/blood.js     blood droplets, per-pixel decals, and FX (sparks, smoke, text)
js/npc.js       NPC brains and pose-driven active ragdoll
js/weapons.js   harpoon spikes, tentacle, laser constants
js/player.js    the Subject: movement, weapons, pixel puppet
js/game.js      world step, camera, objectives, HUD
js/main.js      boot and fixed-timestep loop
```

To edit the test map, change the ASCII in `TEST_MAP` (`js/map.js`): `#` wall, `=` girder,
`P` player, `G` guard dummy, `S` scientist.
