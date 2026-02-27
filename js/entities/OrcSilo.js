/* ============================================================
   OrcSilo.js
   ============================================================
   A massive reinforced missile launch silo embedded into the
   alien ground — a significant military installation far heavier
   and more imposing than the OrcCannon field emplacement.

   Visual design: drawn entirely with fillRect (no arcs, no
   gradients, no ellipses). Built in layers from ground up:

     Ground embedding  → excavated pit collar, reinforced
                          concrete foundation blocks
     Silo body         → squat armored cylinder rendered as
                          flat pixel-art panels with bolted
                          seams, pipe runs, orc glyphs,
                          Voidheart conduits, ventilation slots,
                          battle damage and crude repair patches
     Blast doors       → two CLOSED heavy armored panels on
                          the silo top with warning stripes,
                          hydraulic hinge blocks, red warning
                          light
     Orc crew          → two ground-crew orcs beside the silo,
                          one holding a clipboard

   All dimensions use a base grid of 16px tiles. The silo body
   is ~64px wide × 80px tall; the pit collar ~80px wide × 12px.

   ----------------------------------------------------------------
   HEALTH & DAMAGE STATES
   ----------------------------------------------------------------
   10 hit points (HealthSystem). Progressive visual damage:
     After hit 3:  scorch marks appear on one armor panel
     After hit 6:  right blast door is visibly bent (2px offset
                   + crack pixels along its edge)
     After hit 9:  both Voidheart conduits spark — 3 bright
                   pixel flickers per conduit each frame
     After hit 10: destruction — entity removed (health.onDeath)

   ----------------------------------------------------------------
   PUBLIC API (called from PilotGameState)
   ----------------------------------------------------------------
   render(ctx, cameraX)
     Converts worldX → screenX, culls off-screen, then draws.
     No update() — visual only, no behavior yet.

   isAlive()
     Returns true while health > 0; false after death callback.
   ============================================================ */

class OrcSilo {

  constructor(worldX, groundY) {
    // World-space X centre of the silo structure
    this.worldX   = worldX;
    // Screen-space Y of the ground surface the silo sits on
    this._groundY = groundY;

    // ---- Health: 10 hit points ----
    this.health    = new HealthSystem(10);
    this._hitCount = 0;

    // ---- Damage-state flags ----
    this._scorchVisible  = false; // after hit 3:  scorch marks on armor panel
    this._doorBent       = false; // after hit 6:  right door offset + crack
    this._conduitSparks  = false; // after hit 9:  conduit spark flickers
    this._dead           = false;

    // ---- Spark flicker state (conduit damage) ----
    // Three spark positions along each conduit, toggled each frame
    this._sparkPhase = 0; // increments each render call when conduitSparks

    // ---- Damage callbacks ----
    this.health.onDamage(() => {
      this._hitCount++;
      if (this._hitCount >= 3)  this._scorchVisible = true;
      if (this._hitCount >= 6)  this._doorBent      = true;
      if (this._hitCount >= 9)  this._conduitSparks = true;
    });

    this.health.onDeath(() => {
      this._dead = true;
    });
  }

  // Convenience — PilotGameState skips render when this returns false
  isAlive() { return !this._dead; }

  // ================================================================
  // RENDER — called every frame from PilotGameState.render()
  //
  // cameraX : world-space X of the screen's left edge
  // ================================================================

  render(ctx, cameraX) {
    if (this._dead) return;

    const screenX = Math.round(this.worldX - cameraX);
    // Cull structures entirely off-screen (silo is ~80px wide)
    if (screenX < -100 || screenX > 1060) return;

    ctx.save();
    ctx.translate(screenX, this._groundY);

    // Advance spark animation phase each rendered frame
    if (this._conduitSparks) {
      this._sparkPhase = (this._sparkPhase + 1) % 6;
    }

    this._renderPitCollar(ctx);
    this._renderFoundation(ctx);
    this._renderSiloBody(ctx);
    this._renderBlastDoors(ctx);
    this._renderOrcCrew(ctx);

    ctx.restore();
  }

  // ================================================================
  // PRIVATE — GROUND EMBEDDING: PIT COLLAR
  // ================================================================

  // Wide excavated pit collar around the silo base — disturbed alien
  // soil in layered earth tones, approximately 80px wide × 12px tall.
  _renderPitCollar(ctx) {

    // Outermost disturbed earth layer — widest, darkest alien soil
    ctx.fillStyle = '#1a1008';
    ctx.fillRect(-40, -12, 80, 12);

    // Second earth layer — slightly lighter, shows excavation depth
    ctx.fillStyle = '#2a1a0c';
    ctx.fillRect(-36, -10, 72, 10);

    // Third layer — alien soil mid-tone with purple tint (alien ground)
    ctx.fillStyle = '#241612';
    ctx.fillRect(-32, -8, 64, 8);

    // Loose rubble strips at the collar edges — disturbed by construction
    ctx.fillStyle = '#3a2810';
    ctx.fillRect(-40, -5, 8, 4);   // left rubble mound
    ctx.fillRect( 32, -5, 8, 4);   // right rubble mound

    // Scattered 1px dirt clods at the outer disturbed edge
    ctx.fillStyle = '#4a3818';
    ctx.fillRect(-39, -8, 1, 1);
    ctx.fillRect(-35, -6, 1, 1);
    ctx.fillRect(-31, -4, 1, 1);
    ctx.fillRect( 31, -4, 1, 1);
    ctx.fillRect( 35, -6, 1, 1);
    ctx.fillRect( 38, -8, 1, 1);

    // Darker alien soil veins — 1px horizontal streaks showing rock layers
    ctx.fillStyle = '#140c08';
    ctx.fillRect(-36, -9, 72, 1);   // deep stratum line
    ctx.fillRect(-30, -6, 60, 1);   // mid stratum line

    // Edge highlight — brighter disturbed topsoil at the very outer rim
    ctx.fillStyle = '#5a4020';
    ctx.fillRect(-40, -12, 80, 1);  // top edge highlight
  }

  // ================================================================
  // PRIVATE — GROUND EMBEDDING: REINFORCED FOUNDATION
  // ================================================================

  // Thick concrete-like foundation blocks at the silo base edges —
  // dark grey with pour-line seams and stress crack details.
  _renderFoundation(ctx) {

    // Left foundation block — embedded into the pit collar
    ctx.fillStyle = '#383838';
    ctx.fillRect(-36, -20, 10, 20);

    // Pour-line seams — horizontal 1px darker lines across the block
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(-36, -15, 10, 1);   // upper seam
    ctx.fillRect(-36, -10, 10, 1);   // mid seam
    ctx.fillRect(-36,  -5, 10, 1);   // lower seam

    // Stress crack — diagonal 1px zigzag suggesting structural load
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(-33, -19, 1, 2);
    ctx.fillRect(-32, -17, 1, 2);
    ctx.fillRect(-31, -15, 1, 2);
    ctx.fillRect(-32, -13, 1, 2);

    // Bright edge highlight — concrete face catching ambient light
    ctx.fillStyle = '#484848';
    ctx.fillRect(-36, -20, 1, 20);   // left face bright edge
    ctx.fillRect(-36, -20, 10, 1);   // top face bright edge

    // Right foundation block — mirror of left
    ctx.fillStyle = '#383838';
    ctx.fillRect( 26, -20, 10, 20);

    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect( 26, -15, 10, 1);
    ctx.fillRect( 26, -10, 10, 1);
    ctx.fillRect( 26,  -5, 10, 1);

    // Stress crack on right block
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect( 30, -18, 1, 2);
    ctx.fillRect( 31, -16, 1, 2);
    ctx.fillRect( 30, -14, 1, 2);
    ctx.fillRect( 29, -12, 1, 2);

    ctx.fillStyle = '#484848';
    ctx.fillRect( 35, -20, 1, 20);   // right face bright edge
    ctx.fillRect( 26, -20, 10, 1);   // top face bright edge
  }

  // ================================================================
  // PRIVATE — SILO BODY
  // ================================================================

  // Squat massive armored cylinder ~64px wide × 80px tall. Rendered as
  // flat-faced pixel-art panels with heavy salvage construction detail.
  _renderSiloBody(ctx) {
    const TOP    = -92;   // y of silo body top (below blast doors)
    const BOTTOM = -12;   // y of silo base (sits on foundation)
    const LEFT   = -32;   // x of left edge
    const RIGHT  =  32;   // x of right edge
    const WIDTH  =  64;
    const HEIGHT =  80;

    // ----------------------------------------------------------------
    // MAIN BODY — dark base metal, the core structure of the silo
    // ----------------------------------------------------------------
    ctx.fillStyle = '#303038';
    ctx.fillRect(LEFT, TOP, WIDTH, HEIGHT);

    // ----------------------------------------------------------------
    // ARMOUR PANELS — large dark metal sections with bolted seams
    // The silo shows mismatched panel colors from different scrap sources
    // ----------------------------------------------------------------

    // Left panel — slightly lighter, different source metal (salvage)
    ctx.fillStyle = '#383842';
    ctx.fillRect(LEFT, TOP, 30, HEIGHT);

    // Right panel — darker tone, different origin scrap
    ctx.fillStyle = '#282830';
    ctx.fillRect(LEFT + 34, TOP, 30, HEIGHT);

    // Centre seam between panels — bold 4px black gap suggesting welded joint
    ctx.fillStyle = '#0e0e14';
    ctx.fillRect(LEFT + 29, TOP, 5, HEIGHT);

    // ----------------------------------------------------------------
    // HORIZONTAL PANEL SEAMS — rows dividing panels into sections
    // Heavy bolted armor feel; three horizontal seam bands
    // ----------------------------------------------------------------
    ctx.fillStyle = '#1a1a22';
    ctx.fillRect(LEFT, TOP + 20, WIDTH, 3);   // upper seam band
    ctx.fillRect(LEFT, TOP + 42, WIDTH, 3);   // mid seam band
    ctx.fillRect(LEFT, TOP + 62, WIDTH, 3);   // lower seam band

    // Seam edge highlights — bright 1px line above each seam
    ctx.fillStyle = '#4a4a58';
    ctx.fillRect(LEFT, TOP + 19, WIDTH, 1);   // above upper seam
    ctx.fillRect(LEFT, TOP + 41, WIDTH, 1);   // above mid seam
    ctx.fillRect(LEFT, TOP + 61, WIDTH, 1);   // above lower seam

    // ----------------------------------------------------------------
    // PANEL SURFACE DETAIL — rivets along seam lines
    // ----------------------------------------------------------------
    // Upper seam rivets — bright grey head + dark shadow
    ctx.fillStyle = '#848494';
    ctx.fillRect(LEFT + 4,  TOP + 20, 2, 2);
    ctx.fillRect(LEFT + 12, TOP + 20, 2, 2);
    ctx.fillRect(LEFT + 20, TOP + 20, 2, 2);
    ctx.fillRect(LEFT + 34, TOP + 20, 2, 2);
    ctx.fillRect(LEFT + 42, TOP + 20, 2, 2);
    ctx.fillRect(LEFT + 55, TOP + 20, 2, 2);
    ctx.fillStyle = '#18181e';
    ctx.fillRect(LEFT + 4,  TOP + 22, 2, 1);
    ctx.fillRect(LEFT + 12, TOP + 22, 2, 1);
    ctx.fillRect(LEFT + 20, TOP + 22, 2, 1);
    ctx.fillRect(LEFT + 34, TOP + 22, 2, 1);
    ctx.fillRect(LEFT + 42, TOP + 22, 2, 1);
    ctx.fillRect(LEFT + 55, TOP + 22, 2, 1);

    // Mid seam rivets
    ctx.fillStyle = '#848494';
    ctx.fillRect(LEFT + 6,  TOP + 42, 2, 2);
    ctx.fillRect(LEFT + 16, TOP + 42, 2, 2);
    ctx.fillRect(LEFT + 25, TOP + 42, 2, 2);
    ctx.fillRect(LEFT + 37, TOP + 42, 2, 2);
    ctx.fillRect(LEFT + 47, TOP + 42, 2, 2);
    ctx.fillRect(LEFT + 57, TOP + 42, 2, 2);
    ctx.fillStyle = '#18181e';
    ctx.fillRect(LEFT + 6,  TOP + 44, 2, 1);
    ctx.fillRect(LEFT + 16, TOP + 44, 2, 1);
    ctx.fillRect(LEFT + 25, TOP + 44, 2, 1);
    ctx.fillRect(LEFT + 37, TOP + 44, 2, 1);
    ctx.fillRect(LEFT + 47, TOP + 44, 2, 1);
    ctx.fillRect(LEFT + 57, TOP + 44, 2, 1);

    // ----------------------------------------------------------------
    // EXPOSED PIPE RUNS — orc salvage; crude pipes run on exterior
    // ----------------------------------------------------------------
    // Left pipe run — vertical dark pipe with highlight
    ctx.fillStyle = '#1e2030';
    ctx.fillRect(LEFT + 3, TOP + 5, 3, 55);   // pipe body
    ctx.fillStyle = '#3a3c50';
    ctx.fillRect(LEFT + 3, TOP + 5, 1, 55);   // pipe highlight edge
    // Pipe junction collars — thicker rings at intervals
    ctx.fillStyle = '#28283c';
    ctx.fillRect(LEFT + 2, TOP + 16, 5, 4);   // upper collar
    ctx.fillRect(LEFT + 2, TOP + 36, 5, 4);   // mid collar
    ctx.fillRect(LEFT + 2, TOP + 52, 5, 4);   // lower collar

    // Right pipe run — slightly different shade (different material)
    ctx.fillStyle = '#251f2a';
    ctx.fillRect(LEFT + 57, TOP + 8, 3, 50);  // pipe body
    ctx.fillStyle = '#403848';
    ctx.fillRect(LEFT + 59, TOP + 8, 1, 50);  // highlight on right edge
    // Collars
    ctx.fillStyle = '#302838';
    ctx.fillRect(LEFT + 56, TOP + 20, 5, 4);
    ctx.fillRect(LEFT + 56, TOP + 40, 5, 4);

    // ----------------------------------------------------------------
    // ORC GLYPH — scratched into the right panel, crude rune marks
    // ----------------------------------------------------------------
    ctx.fillStyle = '#1c1c26';
    // Vertical stroke
    ctx.fillRect(LEFT + 46, TOP + 28, 2, 10);
    // Diagonal left stroke
    ctx.fillRect(LEFT + 43, TOP + 30, 2, 2);
    ctx.fillRect(LEFT + 44, TOP + 32, 2, 2);
    ctx.fillRect(LEFT + 45, TOP + 34, 2, 2);
    // Horizontal bar
    ctx.fillRect(LEFT + 43, TOP + 29, 8, 2);
    // Top tick
    ctx.fillRect(LEFT + 47, TOP + 25, 2, 4);
    // Bottom hook
    ctx.fillRect(LEFT + 46, TOP + 37, 4, 2);

    // Glyph bright scratch lines — 1px lighter etching on top
    ctx.fillStyle = '#38384a';
    ctx.fillRect(LEFT + 46, TOP + 28, 1, 9);
    ctx.fillRect(LEFT + 43, TOP + 29, 7, 1);

    // ----------------------------------------------------------------
    // VOIDHEART ORE POWER CONDUITS — thin 2px lines up the sides,
    // deep purplish-red with faint glow, running full silo height
    // ----------------------------------------------------------------

    // Left conduit
    ctx.fillStyle = '#3c0a28';
    ctx.fillRect(LEFT + 8,  TOP, 2, HEIGHT);
    ctx.fillStyle = '#580e38';
    ctx.fillRect(LEFT + 8,  TOP, 1, HEIGHT);  // inner highlight

    // Right conduit
    ctx.fillStyle = '#3c0a28';
    ctx.fillRect(LEFT + 54, TOP, 2, HEIGHT);
    ctx.fillStyle = '#580e38';
    ctx.fillRect(LEFT + 55, TOP, 1, HEIGHT);  // inner highlight

    // Conduit junction nodes — small square connectors at seam lines
    ctx.fillStyle = '#7a1050';
    ctx.fillRect(LEFT + 7,  TOP + 18, 4, 4);  // left upper node
    ctx.fillRect(LEFT + 7,  TOP + 40, 4, 4);  // left mid node
    ctx.fillRect(LEFT + 7,  TOP + 60, 4, 4);  // left lower node
    ctx.fillRect(LEFT + 53, TOP + 18, 4, 4);  // right upper node
    ctx.fillRect(LEFT + 53, TOP + 40, 4, 4);  // right mid node
    ctx.fillRect(LEFT + 53, TOP + 60, 4, 4);  // right lower node

    // Conduit sparks (damage state 9+) — 3 bright pixel flickers
    if (this._conduitSparks) {
      const sp = this._sparkPhase;
      // Left conduit sparks — positions shift by sparkPhase
      const sparkColors = ['#ff80d0', '#ffaaee', '#ffffff'];
      const leftYs  = [TOP + 14, TOP + 38, TOP + 58];
      const rightYs = [TOP + 22, TOP + 44, TOP + 66];
      for (let i = 0; i < 3; i++) {
        const sIdx = (sp + i) % 3;
        ctx.fillStyle = sparkColors[sIdx];
        // Left conduit sparks
        ctx.fillRect(LEFT + 6,  leftYs[i]  + ((sp * 3) % 5) - 2, 2, 2);
        // Right conduit sparks
        ctx.fillRect(LEFT + 53, rightYs[i] + ((sp * 2) % 4) - 1, 2, 2);
      }
    }

    // ----------------------------------------------------------------
    // VENTILATION SLOTS — near the base, rows of 1px dark slots
    // with bright edge highlights suggesting air flow channels
    // ----------------------------------------------------------------
    const ventY = TOP + 65;
    // Left vent bank
    ctx.fillStyle = '#0a0a10';
    for (let vi = 0; vi < 6; vi++) {
      ctx.fillRect(LEFT + 11 + vi * 3, ventY, 2, 5);      // dark slot
    }
    // Bright top edge on each slot — metal rim above the opening
    ctx.fillStyle = '#5a5a6a';
    for (let vi = 0; vi < 6; vi++) {
      ctx.fillRect(LEFT + 11 + vi * 3, ventY, 2, 1);      // rim highlight
    }

    // Right vent bank (mirrored side)
    ctx.fillStyle = '#0a0a10';
    for (let vi = 0; vi < 6; vi++) {
      ctx.fillRect(LEFT + 37 + vi * 3, ventY, 2, 5);
    }
    ctx.fillStyle = '#5a5a6a';
    for (let vi = 0; vi < 6; vi++) {
      ctx.fillRect(LEFT + 37 + vi * 3, ventY, 2, 1);
    }

    // ----------------------------------------------------------------
    // BATTLE DAMAGE DETAILS
    // ----------------------------------------------------------------

    // Dent / impact mark on the left panel — dark recessed pixels
    ctx.fillStyle = '#1a1a22';
    ctx.fillRect(LEFT + 14, TOP + 30, 6, 4);   // dent main area
    ctx.fillStyle = '#0a0a10';
    ctx.fillRect(LEFT + 15, TOP + 31, 4, 2);   // deep dent centre
    ctx.fillStyle = '#484858';
    ctx.fillRect(LEFT + 14, TOP + 30, 6, 1);   // bright rim above dent

    // Scorch mark — applied after hit 3
    if (this._scorchVisible) {
      ctx.fillStyle = '#0a0808';
      ctx.fillRect(LEFT + 36, TOP + 47, 12, 8);  // main scorch area
      ctx.fillRect(LEFT + 38, TOP + 43, 8,  5);  // scorch tongue
      // Scattered char pixels
      ctx.fillStyle = '#1a1010';
      ctx.fillRect(LEFT + 34, TOP + 50, 2, 2);
      ctx.fillRect(LEFT + 48, TOP + 48, 2, 2);
      ctx.fillRect(LEFT + 40, TOP + 55, 2, 2);
      ctx.fillRect(LEFT + 44, TOP + 45, 1, 1);
      ctx.fillRect(LEFT + 36, TOP + 53, 1, 1);
    }

    // Crude repair patch — different metal color on lower-left of right panel
    // Suggests a previous penetrating hit, repaired in the field
    ctx.fillStyle = '#4a3828';                     // brownish crude patch metal
    ctx.fillRect(LEFT + 36, TOP + 53, 14, 10);
    ctx.fillStyle = '#3a2c1c';                     // patch panel seam
    ctx.fillRect(LEFT + 36, TOP + 53, 14, 1);     // top edge seam
    ctx.fillRect(LEFT + 36, TOP + 62, 14, 1);     // bottom edge seam
    ctx.fillRect(LEFT + 36, TOP + 53, 1,  10);    // left edge seam
    ctx.fillRect(LEFT + 49, TOP + 53, 1,  10);    // right edge seam
    // Patch rivets — visible welding points
    ctx.fillStyle = '#7a6040';
    ctx.fillRect(LEFT + 37, TOP + 54, 2, 2);
    ctx.fillRect(LEFT + 47, TOP + 54, 2, 2);
    ctx.fillRect(LEFT + 37, TOP + 60, 2, 2);
    ctx.fillRect(LEFT + 47, TOP + 60, 2, 2);

    // ----------------------------------------------------------------
    // OUTER EDGE SHADING — left/right face highlights for 3D depth
    // ----------------------------------------------------------------
    ctx.fillStyle = '#484858';
    ctx.fillRect(LEFT, TOP, 2, HEIGHT);           // left face light edge
    ctx.fillStyle = '#18181e';
    ctx.fillRect(RIGHT - 2, TOP, 2, HEIGHT);      // right face shadow edge
  }

  // ================================================================
  // PRIVATE — BLAST DOORS (CLOSED state)
  // ================================================================

  // Two heavy blast door panels meeting at the centre of the silo top.
  // Each approximately 30px wide × 16px tall with warning stripes,
  // hydraulic hinge mechanisms, and a red warning light at centre seam.
  _renderBlastDoors(ctx) {
    const DOOR_TOP = -108;   // y of blast door top face
    const DOOR_H   =  16;
    const DOOR_W   =  30;
    const CENTER   =   0;

    // Damage state 6+: right door is bent — shift it 2px down and right
    const rightOffX = this._doorBent ? 2 : 0;
    const rightOffY = this._doorBent ? 2 : 0;

    // ----------------------------------------------------------------
    // LEFT BLAST DOOR PANEL
    // ----------------------------------------------------------------
    // Main door body — thick dark armored steel
    ctx.fillStyle = '#2c2c36';
    ctx.fillRect(CENTER - DOOR_W - 2, DOOR_TOP, DOOR_W, DOOR_H);

    // Top face bevel — bright edge showing door thickness
    ctx.fillStyle = '#4c4c5e';
    ctx.fillRect(CENTER - DOOR_W - 2, DOOR_TOP, DOOR_W, 2);

    // Inner panel layer — slightly recessed surface detail
    ctx.fillStyle = '#262630';
    ctx.fillRect(CENTER - DOOR_W + 0, DOOR_TOP + 3, DOOR_W - 4, DOOR_H - 6);

    // Bold seam lines dividing the door into armour sections
    ctx.fillStyle = '#14141c';
    ctx.fillRect(CENTER - DOOR_W - 2, DOOR_TOP + 5,  DOOR_W, 2);  // upper seam
    ctx.fillRect(CENTER - DOOR_W - 2, DOOR_TOP + 11, DOOR_W, 2);  // lower seam

    // Warning stripes — alternating 2px diagonal lines (dark yellow + black)
    // Drawn as a series of 2px-wide vertical strips, alternating color
    for (let si = 0; si < DOOR_W; si += 4) {
      ctx.fillStyle = '#5a4800';
      ctx.fillRect(CENTER - DOOR_W - 2 + si,     DOOR_TOP + 3, 2, DOOR_H - 6);
      ctx.fillStyle = '#0e0e0e';
      ctx.fillRect(CENTER - DOOR_W - 2 + si + 2, DOOR_TOP + 3, 2, DOOR_H - 6);
    }

    // Hydraulic hinge mechanism — outer-left edge, rectangular block
    ctx.fillStyle = '#383844';
    ctx.fillRect(CENTER - DOOR_W - 6, DOOR_TOP + 1, 6, DOOR_H - 2);
    ctx.fillStyle = '#505060';
    ctx.fillRect(CENTER - DOOR_W - 6, DOOR_TOP + 1, 1, DOOR_H - 2);   // highlight
    ctx.fillStyle = '#1a1a22';
    ctx.fillRect(CENTER - DOOR_W - 1, DOOR_TOP + 1, 1, DOOR_H - 2);   // inner shadow
    // Hinge cylinder detail — 2 small rectangles simulating the cylinder barrel
    ctx.fillStyle = '#606070';
    ctx.fillRect(CENTER - DOOR_W - 5, DOOR_TOP + 4, 4, 3);
    ctx.fillRect(CENTER - DOOR_W - 5, DOOR_TOP + 9, 4, 3);

    // ----------------------------------------------------------------
    // RIGHT BLAST DOOR PANEL
    // ----------------------------------------------------------------
    ctx.fillStyle = '#2c2c36';
    ctx.fillRect(CENTER + 2 + rightOffX, DOOR_TOP + rightOffY, DOOR_W, DOOR_H);

    ctx.fillStyle = '#4c4c5e';
    ctx.fillRect(CENTER + 2 + rightOffX, DOOR_TOP + rightOffY, DOOR_W, 2);

    ctx.fillStyle = '#262630';
    ctx.fillRect(CENTER + 4 + rightOffX, DOOR_TOP + 3 + rightOffY, DOOR_W - 4, DOOR_H - 6);

    ctx.fillStyle = '#14141c';
    ctx.fillRect(CENTER + 2 + rightOffX, DOOR_TOP + 5  + rightOffY, DOOR_W, 2);
    ctx.fillRect(CENTER + 2 + rightOffX, DOOR_TOP + 11 + rightOffY, DOOR_W, 2);

    // Warning stripes on right door
    for (let si = 0; si < DOOR_W; si += 4) {
      ctx.fillStyle = '#5a4800';
      ctx.fillRect(CENTER + 2 + rightOffX + si,     DOOR_TOP + 3 + rightOffY, 2, DOOR_H - 6);
      ctx.fillStyle = '#0e0e0e';
      ctx.fillRect(CENTER + 2 + rightOffX + si + 2, DOOR_TOP + 3 + rightOffY, 2, DOOR_H - 6);
    }

    // Right hydraulic hinge mechanism
    ctx.fillStyle = '#383844';
    ctx.fillRect(CENTER + DOOR_W + 2 + rightOffX, DOOR_TOP + 1 + rightOffY, 6, DOOR_H - 2);
    ctx.fillStyle = '#505060';
    ctx.fillRect(CENTER + DOOR_W + 7 + rightOffX, DOOR_TOP + 1 + rightOffY, 1, DOOR_H - 2);
    ctx.fillStyle = '#1a1a22';
    ctx.fillRect(CENTER + 2 + rightOffX,           DOOR_TOP + 1 + rightOffY, 1, DOOR_H - 2);
    ctx.fillStyle = '#606070';
    ctx.fillRect(CENTER + DOOR_W + 3 + rightOffX, DOOR_TOP + 4 + rightOffY, 4, 3);
    ctx.fillRect(CENTER + DOOR_W + 3 + rightOffX, DOOR_TOP + 9 + rightOffY, 4, 3);

    // Bent door damage (hit 6+) — crack pixels along left edge of right door
    if (this._doorBent) {
      ctx.fillStyle = '#0a0a12';
      ctx.fillRect(CENTER + 2 + rightOffX, DOOR_TOP + rightOffY,     1, 4);
      ctx.fillRect(CENTER + 3 + rightOffX, DOOR_TOP + 4 + rightOffY, 1, 4);
      ctx.fillRect(CENTER + 2 + rightOffX, DOOR_TOP + 8 + rightOffY, 1, 4);
      ctx.fillRect(CENTER + 3 + rightOffX, DOOR_TOP + 12 + rightOffY,1, 4);
      // Bright stress pixels beside cracks
      ctx.fillStyle = '#5a5a6a';
      ctx.fillRect(CENTER + 4 + rightOffX, DOOR_TOP + 2 + rightOffY, 1, 2);
      ctx.fillRect(CENTER + 4 + rightOffX, DOOR_TOP + 9 + rightOffY, 1, 2);
    }

    // ----------------------------------------------------------------
    // CENTRE SEAM — gap between the two doors meeting in the middle
    // ----------------------------------------------------------------
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(CENTER - 2, DOOR_TOP, 4, DOOR_H);

    // Red warning light — 2×2px bright red pixel at centre seam
    ctx.fillStyle = '#ff2020';
    ctx.fillRect(CENTER - 1, DOOR_TOP + 7, 2, 2);
    // Tiny glow halo — 1px pixels adjacent (dim red)
    ctx.fillStyle = '#880808';
    ctx.fillRect(CENTER - 2, DOOR_TOP + 7, 1, 2);
    ctx.fillRect(CENTER + 2, DOOR_TOP + 7, 1, 2);
    ctx.fillRect(CENTER - 1, DOOR_TOP + 6, 2, 1);
    ctx.fillRect(CENTER - 1, DOOR_TOP + 9, 2, 1);
  }

  // ================================================================
  // PRIVATE — ORC CREW MEMBERS
  // ================================================================

  // Two ground-crew orcs beside the silo, approximately 12px wide ×
  // 18px tall. Same art standard as OrcCannon gunner — green skin,
  // armor, visible face details, small rank plumes.
  // One has a clipboard-like object (monitor launching sequence).
  _renderOrcCrew(ctx) {

    // ================================================================
    // CREW MEMBER 1 — left side, holding a clipboard
    // Standing at ground level (y = 0) to the left of the silo
    // ================================================================
    const c1x = -50; // centre X of crew member 1

    // Boots — dark soles at ground level
    ctx.fillStyle = '#1e1208';
    ctx.fillRect(c1x - 4, -3, 3, 3);   // left boot
    ctx.fillRect(c1x + 1, -3, 3, 3);   // right boot
    ctx.fillStyle = '#3a2010';
    ctx.fillRect(c1x - 4, -3, 3, 1);   // left boot toe highlight
    ctx.fillRect(c1x + 1, -3, 3, 1);   // right boot toe highlight

    // Lower legs — dark-green pants
    ctx.fillStyle = '#2e5e12';
    ctx.fillRect(c1x - 4, -7, 3, 4);
    ctx.fillRect(c1x + 1, -7, 3, 4);
    // Inner leg shadow
    ctx.fillStyle = '#1e4008';
    ctx.fillRect(c1x - 2, -7, 1, 4);
    ctx.fillRect(c1x + 1, -7, 1, 4);

    // Torso — dark armour, 10px wide × 9px tall
    ctx.fillStyle = '#2a2018';
    ctx.fillRect(c1x - 5, -16, 10, 9);
    // Chest panel seam
    ctx.fillStyle = '#1a1408';
    ctx.fillRect(c1x - 5, -13, 10, 1);
    ctx.fillRect(c1x,     -16,  1, 9);  // vertical seam

    // Left arm — bare green skin, reaching down to hold clipboard
    ctx.fillStyle = '#4a9420';
    ctx.fillRect(c1x - 7, -15, 2, 8);
    ctx.fillStyle = '#3a7a18';
    ctx.fillRect(c1x - 6, -15, 1, 8);  // shadow edge

    // Right arm — green, extended slightly forward
    ctx.fillStyle = '#4a9420';
    ctx.fillRect(c1x + 5, -14, 2, 7);

    // Clipboard — small rectangle held in left hand
    ctx.fillStyle = '#b8a070';           // light tan clipboard body
    ctx.fillRect(c1x - 10, -13, 6, 8);
    ctx.fillStyle = '#8a7040';           // clipboard border/clip
    ctx.fillRect(c1x - 10, -13, 6, 1);  // top clip bar
    ctx.fillRect(c1x - 10, -13, 1, 8);  // left edge border
    ctx.fillRect(c1x - 5,  -13, 1, 8);  // right edge border
    // Data lines on clipboard — dark pixel rows suggesting readouts
    ctx.fillStyle = '#5a4820';
    ctx.fillRect(c1x - 9, -11, 4, 1);
    ctx.fillRect(c1x - 9, -9,  4, 1);
    ctx.fillRect(c1x - 9, -7,  3, 1);

    // Head — blocky 8px wide × 6px tall
    ctx.fillStyle = '#4a9420';
    ctx.fillRect(c1x - 4, -22, 8, 6);
    // Jaw shadow
    ctx.fillStyle = '#3a7a18';
    ctx.fillRect(c1x - 4, -18, 8, 2);
    // Eyes — 1px bright dots
    ctx.fillStyle = '#ff4400';           // orc red-orange eyes
    ctx.fillRect(c1x - 3, -21, 1, 1);
    ctx.fillRect(c1x + 2, -21, 1, 1);
    // Brow ridge — 1px dark line above eyes
    ctx.fillStyle = '#2a6010';
    ctx.fillRect(c1x - 3, -22, 6, 1);
    // Tusks — small 1px white pixels below the jaw
    ctx.fillStyle = '#e8e0c0';
    ctx.fillRect(c1x - 2, -17, 1, 2);
    ctx.fillRect(c1x + 1, -17, 1, 2);

    // Rank plume — small 3px wide neon plume (lower rank than OrcCannon gunner)
    ctx.fillStyle = '#00ff88';           // dim rank-green plume
    ctx.fillRect(c1x - 1, -26, 3, 4);
    ctx.fillStyle = '#00cc66';           // plume base
    ctx.fillRect(c1x - 1, -23, 3, 1);

    // ================================================================
    // CREW MEMBER 2 — right side, standing at attention watching silo
    // ================================================================
    const c2x = 50; // centre X of crew member 2

    // Boots
    ctx.fillStyle = '#1e1208';
    ctx.fillRect(c2x - 4, -3, 3, 3);
    ctx.fillRect(c2x + 1, -3, 3, 3);
    ctx.fillStyle = '#3a2010';
    ctx.fillRect(c2x - 4, -3, 3, 1);
    ctx.fillRect(c2x + 1, -3, 3, 1);

    // Lower legs
    ctx.fillStyle = '#2e5e12';
    ctx.fillRect(c2x - 4, -7, 3, 4);
    ctx.fillRect(c2x + 1, -7, 3, 4);
    ctx.fillStyle = '#1e4008';
    ctx.fillRect(c2x - 2, -7, 1, 4);
    ctx.fillRect(c2x + 1, -7, 1, 4);

    // Torso — slightly heavier armour detail (crew chief)
    ctx.fillStyle = '#2a2018';
    ctx.fillRect(c2x - 5, -16, 10, 9);
    ctx.fillStyle = '#3a3028';           // shoulder plate highlight
    ctx.fillRect(c2x - 5, -16, 10, 2);
    ctx.fillStyle = '#1a1408';
    ctx.fillRect(c2x - 5, -13, 10, 1);
    ctx.fillRect(c2x,     -16,  1, 9);

    // Right shoulder augment — small brass block (rank indicator)
    ctx.fillStyle = '#7a5a18';
    ctx.fillRect(c2x + 5, -17, 4, 7);
    ctx.fillStyle = '#c4a040';
    ctx.fillRect(c2x + 8, -17, 1, 7);   // bright edge
    ctx.fillRect(c2x + 5, -17, 4, 1);   // top edge

    // Arms — both at sides, attention stance
    ctx.fillStyle = '#4a9420';
    ctx.fillRect(c2x - 7, -15, 2, 8);
    ctx.fillRect(c2x + 5, -15, 2, 8);
    ctx.fillStyle = '#3a7a18';
    ctx.fillRect(c2x - 6, -15, 1, 8);

    // Head — slightly different expression (looking toward silo)
    ctx.fillStyle = '#4a9420';
    ctx.fillRect(c2x - 4, -22, 8, 6);
    ctx.fillStyle = '#3a7a18';
    ctx.fillRect(c2x + 2, -22, 2, 6);   // right face shadow (turned slightly)
    ctx.fillRect(c2x - 4, -18, 8, 2);
    ctx.fillStyle = '#ff4400';
    ctx.fillRect(c2x - 3, -21, 1, 1);
    ctx.fillRect(c2x + 1, -21, 1, 1);
    ctx.fillStyle = '#2a6010';
    ctx.fillRect(c2x - 3, -22, 6, 1);
    ctx.fillStyle = '#e8e0c0';
    ctx.fillRect(c2x - 2, -17, 1, 2);
    ctx.fillRect(c2x + 1, -17, 1, 2);

    // Rank plume — slightly taller than crew 1 (crew chief)
    ctx.fillStyle = '#00ff88';
    ctx.fillRect(c2x - 1, -27, 3, 5);
    ctx.fillStyle = '#00ee77';           // second plume feather beside first
    ctx.fillRect(c2x + 2, -26, 2, 4);
    ctx.fillStyle = '#00cc66';
    ctx.fillRect(c2x - 1, -23, 3, 1);
  }
}
