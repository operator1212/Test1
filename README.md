# Subject 09 (working title)

A 2D side-scrolling supernatural shooter, loosely inspired by *Carrion*. Several test
subjects have broken out of containment, and you play them: each creature has its own
procedural body and its own way of killing, and they can all use stolen guns. Blood, ragdolls,
dismemberment.

**The core move:** harpoon a guard's leg to a wall, then go and find the scientist and use the
prototype laser on them.

This repo is the **gameplay sandbox**: one test chamber with dummies, so the mechanics can be
tuned before any real levels exist.

## Run it

No build step and no dependencies. It's plain HTML5 canvas and JavaScript.

- Double-click `index.html`, or
- serve the folder (for example `npx http-server .`) and open it in a browser.

## Controls

| Input | Action |
|---|---|
| WASD | move along whatever you're on: floors, walls and vents. Pushing into a wall runs you up it and over the top. Ceilings can't be gripped |
| push away | pushing away from a wall lets go of it |
| Space | leap off whatever you're holding, along its surface normal. W also jumps from a floor |
| Shift | dash (hold WASD to pick a direction). One air dash per jump, usable off walls; it rams NPCs |
| Mouse | aim |
| LMB | the creature's natural attack (slot 1) or the current gun |
| RMB | Slime: melt into a hidden puddle and back. (The tentacle grapple is kept in the code for creatures that get it later) |
| E | Slime: spit out whoever is inside |
| Tab | switch creature (Worm / Eye / Slime / Crystal / Swarm) |
| 1-6 / Q / mouse wheel | natural attack / harpoon / laser / shotgun / saw / bile bomb |
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
- **Ammo**: stolen guns are limited. The harpoon has 8 shots, the shotgun 6, the saw 4 and
  bile 3. Each regains one round every 8 seconds. The laser runs on a battery that drains
  while firing and slowly recharges.
- **Tentacle grapple** (in the code, but no current creature has it; it's planned as an upgrade):
  - **Swinging:** latch onto terrain and swing on a real pendulum rope. It tensions up
    automatically so the bottom of the arc clears the floor. A/D pump the swing, W/S climb
    or let out rope. Flick the mouse to throw your momentum in the flick's direction.
    Release to fling off with your momentum (plus a little lift).
  - **Bodies:** grab any body part and swing it with the mouse to slam or throw it. E rips
    the grabbed part off a living NPC. Hold E on a loose part or corpse to pull it to your
    mouth and chew through it bite by bite, healing as you go.
- **Creatures** (Tab to switch in place; `js/worm.js`, `js/creatures.js`): the premise is a
  containment breach where several different test subjects escape. They share the
  adhesive-core movement (except the fliers), health, eating and the stolen guns. Each one has
  its own procedural body and a natural attack in weapon slot 1. Nobody grows for now.
  - **Worm:**
    - **Body:** laid along the exact path its head travelled and pressed flat to the surface
      it was on, so it flows over corners and up walls. The tail stays on the ground.
    - **Swallow (hold LMB):** the mouth opens (pink gums, a ring of teeth, lip flaps) and you
      slow down. Anyone who gets into it is pulled inside the body: the worm covers them and
      bulges where they are. Keep holding for 0.8s, then release to digest them. They die and
      are gone, and you heal. Release too early and you spit them out hurt. Digesting takes 2
      seconds, during which the mouth can't open. Releasing on nothing is a small snap bite.
    - **Guns:** carried clamped in its jaws.
  - **Eye:** a floating eyeball that flies freely, trailing an optic nerve.
    - **Tendrils (hold LMB):** two tendrils tear small chunks out of whatever you aim at. You
      fly at half speed while doing it.
    - **Fragile:** 70 HP and it takes 1.3x damage.
    - **Guns:** hang from a nerve under the eye.
  - **Slime:** a real particle fluid (130 particles), drawn as metaballs so it has one smooth,
    gooey outline.
    - **Solid (shape matching):** every particle springs toward its own home spot in a soft
      oval that sits on whatever surface the crawling core is on. So the blob wobbles, leans
      onto walls, squashes flat in low gaps and drips from its underside, but it can't boil
      apart. Victims are folded up inside the oval, blurred behind the goo.
    - **Engulf and dissolve:** roll onto someone to engulf them. They float inside the goo,
      still kicking. Hold LMB to dissolve them pixel by pixel, which is slow and pins you
      down. If you don't finish them they'll struggle free, and E spits them out.
    - **Melt (RMB):** the slime goes fully liquid. It becomes a puddle that flows along the
      floor with A/D and pours off ledges. While it's a puddle, NPCs can't see it and bullets
      pass over it, but it can't attack or shoot. RMB again pulls it back together.
    - **Guns:** float inside the goo.
  - **Crystal:** a walking geode on four stubby rock legs. It's a lumpy stone shell with gold
    flecks and amethyst growths, hollow inside, lined with amethyst and ice crystals, and
    cracked open toward where it aims.
    - **Crystal spear (LMB):** tap to throw a spear grown in the hollow. Hold for up to 0.8s to
      grow it bigger: it flies faster and hits harder. Spears impale and pin like harpoons
      (they count for the objective too) and don't explode.
    - **Armoured:** 160 HP and it takes 0.75x damage, but it's slow.
  - **Swarm:** dozens of individual pixel flies, each steering on its own around the swarm's
    centre.
    - **Devour (hold LMB):** the flies peel off to the cursor, and each one latches onto a
      body pixel and eats it, one bite at a time.
    - **Health is flies:** bullets and explosions kill the flies near the hit, and conscious
      victims swat them. Eating and regeneration breed new ones. Under 5 flies, the swarm is
      dead.
    - **Guns:** carried by a clump of flies.
  - **Subject 09:** the humanoid mutant (the `Player` base class) is out of the rotation for
    now, but all its code is kept so it can come back.
- **Balance** (targets, against a guard with 100 HP):
  - **Creature attacks:** they are nibbles, so they wound vitals rather than instantly killing.
    A creature has to eat a real chunk of brain, and each vital zone bleeds once rather than
    again on every bite.
  - **Time to kill:** measured against a guard standing still, it's roughly 2-5 seconds per
    creature. Crystal spears do 22 damage, plus up to 25 when charged. A charged spear
    through the heart or a headshot can drop someone in one throw.
  - **Enemies:** guards chase and swing batons (12 damage each). Soldiers hit harder (11 per
    bullet), but their aim spreads when you move fast.
  - **Healing:** regeneration only starts after 6 seconds without taking damage.
- **Focus**: slow motion (F) drains a focus meter, which refills slowly and gets topped up
  by kills.
- **Movement (adhesive core)** (`js/player.js`, used by the Worm, Slime and Crystal):
  - **The core:** your body is a small round core that feels every surface around it
    (ray casts in all directions except up) and floats at leg height above whatever it's on,
    held there by a damped spring. Floors, walls and vents are all the same thing. Ceilings
    are never gripped.
  - **Moving:** input is projected along the surface. Pushing into a wall runs you up it and
    around the corner onto the top, and low ceilings make you crouch, then lean into a crawl.
    Push away from a surface to let go, or leap off it with Space.
  - **The body:** nothing is a canned animation. Feet and a free hand plant on real surface
    points and step when they drift too far, knees and elbows are solved with two-bone IK,
    and the body axis follows the surface smoothly.
  - **Getting hit:** enemy bullets hit your actual pixels.
- **Kill slow-down**: killing a soldier who was attacking you briefly slows time.
- **NPCs** (`js/npc.js`):
  - **Security guards** (helmet, visor, uniform) wave until they spot you, then chase you and
    swing their batons.
  - **Scientists** (lab coat, goggles) patrol, panic, flee and cower.
  - **Armed soldiers** (red visor, pistol) shoot at you. Cut off their gun arm and they can't.
  - Your health regenerates after 6 seconds out of combat, and you respawn at the start if
    you die.
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
js/creatures.js Eye, Slime, Crystal and Swarm creatures
js/game.js      world step, camera, objectives, HUD
js/main.js      boot and fixed-timestep loop
```

To edit the test map, change the ASCII in `TEST_MAP` (`js/map.js`): `#` wall, `=` girder,
`P` player, `G` guard, `S` scientist, `A` armed soldier.
