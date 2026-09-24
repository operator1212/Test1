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
| WASD | move along whatever you're on: floors, walls, ceilings, vents. Pushing into a wall runs you up it and over the top |
| push away | pushing away from a wall or ceiling lets go of it |
| Space | leap off whatever you're holding, along its surface normal. W also jumps from a floor |
| Shift | dash (hold WASD to pick a direction). One air dash per jump, usable off walls; it rams NPCs |
| Mouse | aim |
| LMB | fire the current weapon |
| Tab | switch creature (Subject 09 / Worm) |
| RMB (hold) | tentacle grapple: latch onto a surface and swing like a pendulum. Flick the mouse to throw your momentum, A/D to pump, W/S to climb or let out rope, release to fling. Hitting a body grabs it instead (swing it with the mouse, release to throw) |
| E / hold E (while holding) | rip the grabbed part off a living NPC, or hold E to pull a loose part or corpse to your mouth and eat it bite by bite to heal |
| 1-5 / Q / mouse wheel | harpoon / laser / shotgun / saw / bile bomb |
| F | slow motion. Uses the focus meter, which refills slowly and from kills |
| G / T / Y | spawn a guard / scientist / armed soldier at the cursor |
| K | god mode |
| O | screen shake on/off |
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
- **Fatal zones**: every body pixel can carry a vital zone. The brain kills instantly (a
  headshot). The heart means collapse and a fast bleed-out. The spine means paralysis. The neck
  and thigh arteries bleed heavily. NPCs below a quarter of their health go down and bleed out.
  Every damage source checks these zones.
- **Reactions** (a simplified RDR2-style layer on top of the active ragdoll):
  - **Stagger**: non-lethal hits make NPCs stumble with the hit, lean and windmill their
    arms. Big hits floor them.
  - **Dying**: NPCs don't flop straight away. Their knees buckle, or they clutch the wound, or
    they stagger backwards, for about 1-2 seconds, then they go limp and twitch. A headshot
    is a short rigid collapse. A body whose head or torso was cut off stays up for a moment.
  - **Losing a leg**: they crawl away from you on their arms, lie there writhing, or go into
    shock and bleed out. Downed and paralysed NPCs sometimes crawl too, with their arms only.
  - **Throat wounds**: they sometimes stay on their feet, clutching their throat and spraying
    blood, until they collapse.
  - **Head grazes**: losing up to 3 brain pixels has about a 35% chance of being survived.
    They become dazed: head lolling, wandering aimlessly, falling over now and then.
- **Slams**: bodies thrown by the tentacle, rammed by a dash, blown up or dropped from a height
  take impact damage. Hard enough hits burst tissue and crack skulls.
- **Weapons** (`js/weapons.js`):
  - **Harpoon**: impales up to 3 body parts and pins them to whatever surface it hits. A body
    soaks up the spike's momentum. If the spike is too slow to reach a wall, it stays lodged
    in the body.
  - **Prototype laser**: burns away the exact pixels it touches. It overheats.
  - **Shotgun**: 8 pellets. Devastating up close. Damage, hole size and knockback fall off
    with distance, and pellets fizzle out past about 12 tiles. The recoil can boost a jump.
  - **Saw launcher**: a spinning blade that ricochets off walls up to 3 times. It chews
    through flesh gradually and loses speed with every pixel it cuts, so it usually gets
    through about one torso or two limbs before it sticks in someone.
  - **Bile bomb**: a lobbed acid sac that bursts, blowing chunks off anyone nearby and
    splattering green bile.
- **Tentacle grapple**:
  - **Swinging:** latch onto terrain and swing on a real pendulum rope. It tensions up
    automatically so the bottom of the arc clears the floor. A/D pump the swing, W/S climb
    or let out rope. Flick the mouse to throw your momentum in the flick's direction.
    Release to fling off with your momentum (plus a little lift).
  - **Bodies:** grab any body part and swing it with the mouse to slam or throw it. E rips
    the grabbed part off a living NPC. Hold E on a loose part or corpse to pull it to your
    mouth and chew through it bite by bite, healing as you go.
- **Creatures** (Tab to switch in place; `js/worm.js`): the premise is a containment breach
  where several different test subjects escape. They all share the adhesive-core movement,
  health, eating and the tentacle grapple. Each one adds its own body and a natural attack in
  weapon slot 1, and the stolen guns come after that.
  - **Subject 09:** the humanoid mutant, with a procedural body and guns in hand.
  - **Worm:** a segmented body that follows its head over walls, around corners and through
    vents, with a hump wave as it crawls.
    - **Bite:** hold LMB to open the jaws. Pressing lunges forward, and anything in the mouth
      is chewed away pixel by pixel, which heals you. The fatal zones apply, so a bite to the
      throat opens an artery.
    - **Growth:** eating grows the worm a segment every ~120 pixels.
    - **Guns:** carried clamped in its jaws.
    - **Grapple:** a tongue.
  - **Planned:** a floating eye with tendrils that rip chunks out fast, a fly swarm that eats
    single pixels, a slime that traps and dissolves whatever gets stuck in it, and a crystal
    creature whose shards grow inside wounds and burst them.
- **Focus**: slow motion (F) drains a focus meter, which refills slowly and gets topped up
  by kills.
- **Movement (adhesive core)** (`js/player.js`):
  - **The core:** your body is a small round core that feels every surface around it
    (ray casts in all directions) and floats at leg height above whatever it's on, held there
    by a damped spring. Floors, walls, ceilings and vents are all the same thing.
  - **Moving:** input is projected along the surface. Pushing into a wall runs you up it and
    around the corner onto the top, and low ceilings make you crouch, then lean into a crawl.
    Push away from a surface to let go, or leap off it with Space.
  - **The body:** nothing is a canned animation. Feet and a free hand plant on real surface
    points and step when they drift too far, knees and elbows are solved with two-bone IK,
    and the body axis follows the surface smoothly.
  - **Getting hit:** enemy bullets hit your actual pixels.
- **Kill slow-down**: killing a soldier who was attacking you briefly slows time.
- **NPCs** (`js/npc.js`):
  - **Security guards** (helmet, visor, uniform) wave at you.
  - **Scientists** (lab coat, goggles) patrol, panic, flee and cower.
  - **Armed soldiers** (red visor, pistol) shoot at you. Cut off their gun arm and they can't.
  - You have 100 HP that regenerates after a few seconds out of combat, and you respawn at the
    start if you die.
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
js/player.js    shared creature core (movement, health, weapons) + Subject 09
js/worm.js      the Worm creature
js/game.js      world step, camera, objectives, HUD
js/main.js      boot and fixed-timestep loop
```

To edit the test map, change the ASCII in `TEST_MAP` (`js/map.js`): `#` wall, `=` girder,
`P` player, `G` guard, `S` scientist, `A` armed soldier.
