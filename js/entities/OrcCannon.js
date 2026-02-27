/* ============================================================
   OrcCannon.js
   ============================================================
   A ground-based orc anti-aircraft emplacement.
   Visuals and health system only — no movement, projectile
   logic, or collision detection yet.

   VISUAL STRUCTURE (bottom to top, anchor = ground horizon):
     Base plate  → Tower legs → Platform → Orc gunner →
     Cannon barrel → Power cell

   DAMAGE STATES (HealthSystem, 3 max HP):
     0 hits → pristine
     1 hit  → 2px zigzag crack rendered on the left tower leg
     2 hits → platform offset 3px to the right (structural lean)
     dead   → 3-frame collapse: debris rectangles fly outward,
               then this.active = false

   COORDINATE SYSTEM:
     Anchor point: (screenX, groundY) where groundY = 540 × 0.72 = 389.
     All fillRect calls use negative dy to build the structure upward.
     screenX is derived from worldX − cameraX each render call.

   PALETTE:
     Dark iron     #2a2828 / #1e1e1e   Rust edge    #5a3010
     Leg brown-grey #3a3030            Platform     #6a6060
     Orc green     #3a7a2a / #2a5020   Brass        #b87a20 / #d4a030
     Neon plume    #00ff88 / #00aa55   Bore tip     #080808
     Crank handle  #4a3828             Power cell   #8a2a7a (Voidheart Ore)
   ============================================================ */

class OrcCannon {

  // worldX: x-position in world space (same axis as _worldX in PilotGameState)
  constructor(worldX) {
    this.worldX = worldX;
    this.active = true;

    // 3 hit points — one per distinct damage state, plus death on the third
    this.health = new HealthSystem(3);

    // Collapse animation driver: 0 = alive, 1-3 = collapsing frames, 4 = done
    // Incremented inside _renderCollapse each time it is called by render().
    this._collapseFrame = 0;

    // When health reaches zero, prime the collapse sequence so the next
    // render call immediately enters _renderCollapse with frame 1.
    this.health.onDeath(() => {
      this._collapseFrame = 1;
    });
  }

  // ================================================================
  // RENDER
  // ================================================================

  // cameraX: world-space X of the screen's left edge (PilotGameState._cameraX)
  render(ctx, cameraX) {
    if (!this.active) return;

    ctx.imageSmoothingEnabled = false; // pixel-art — no interpolation (Visual Style Guide rule 2)

    // Convert world position to canvas screen position
    const screenX = Math.round(this.worldX - cameraX);

    // Ground anchor — the horizon line sits at 72% of the canvas height
    const py = Math.round(540 * 0.72); // 389

    // Cull — skip drawing if the whole structure is off either screen edge.
    // The structure is at most 32px wide and 62px tall, so 60px margin is safe.
    if (screenX < -60 || screenX > 1020) return;

    // Collapse animation takes over rendering when the cannon is dead
    if (!this.health.isAlive()) {
      this._renderCollapse(ctx, screenX, py);
      return;
    }

    // Number of hits taken drives the damage-state appearance (0, 1, or 2)
    const hits = this.health.maxHealth - this.health.currentHealth;

    ctx.save();
    ctx.translate(screenX, py); // origin now sits at ground level

    // ----------------------------------------------------------------
    // Layer 1 — Base plate
    // Dark iron slab, 32×6px, with a rust-brown top edge and corner rivets.
    // Sits directly on the horizon line (y = 0 in translated space).
    // ----------------------------------------------------------------
    ctx.fillStyle = '#2a2828'; // dark iron body
    ctx.fillRect(-16, -6, 32, 6);

    ctx.fillStyle = '#5a3010'; // rust-brown top edge strip
    ctx.fillRect(-16, -6, 32, 2);

    ctx.fillStyle = '#1a1818'; // darker corner rivet pixels
    ctx.fillRect(-16, -4, 2, 2);
    ctx.fillRect(14,  -4, 2, 2);

    // ----------------------------------------------------------------
    // Layer 2 — Tower legs
    // Two upright columns, intentionally uneven heights (asymmetric junk build).
    //   Left leg:  4×20 px, top at y = −26
    //   Right leg: 4×18 px, top at y = −24  (2px shorter)
    // Both sit in the groove of the base plate (bottom at y = −6).
    // ----------------------------------------------------------------
    ctx.fillStyle = '#3a3030'; // dark brown-grey iron

    // Left leg
    ctx.fillRect(-12, -26, 4, 20);

    // Right leg (2px shorter — the structure was bolted together in the field)
    ctx.fillRect(8, -24, 4, 18);

    // Damage state 1: 2px-wide zigzag crack across the left leg
    if (hits >= 1) {
      ctx.fillStyle = '#1a1414'; // darker crack shadow
      ctx.fillRect(-12, -22, 2, 2);
      ctx.fillRect(-10, -20, 2, 2);
      ctx.fillRect(-12, -18, 2, 2);
      ctx.fillRect(-10, -16, 2, 2);
      ctx.fillRect(-12, -14, 2, 2);
    }

    // ----------------------------------------------------------------
    // Layer 3 — Platform
    // 24×4 px lighter metal plate bridging the two legs.
    // Top of platform at y = −30.  2px bolt pixels at each corner.
    // At damage state 2, offset the entire platform 3px right —
    // the structural lean makes the emplacement look about to topple.
    // ----------------------------------------------------------------
    const plat = hits >= 2 ? 3 : 0; // platform horizontal shift on second hit

    ctx.fillStyle = '#6a6060'; // lighter weathered metal
    ctx.fillRect(-12 + plat, -30, 24, 4);

    // Corner bolts — 2×2 px dark squares at each corner of the platform
    ctx.fillStyle = '#2e2828';
    ctx.fillRect(-12 + plat, -30, 2, 2); // top-left
    ctx.fillRect( 10 + plat, -30, 2, 2); // top-right
    ctx.fillRect(-12 + plat, -28, 2, 2); // bottom-left
    ctx.fillRect( 10 + plat, -28, 2, 2); // bottom-right

    // ----------------------------------------------------------------
    // Layer 4 — Orc gunner
    // Blocky pixel-art figure seated on the platform (~10×22 px silhouette).
    //   Boots      y = −32  (2px, dark)
    //   Pants      y = −36  (4px, dark green)
    //   Torso      y = −43  (7px, orc green)
    //   Head       y = −47  (4px, orc green)
    //   Neon plume y = −53  (6px, neon green)
    //   Brass augment: right shoulder block
    // The gunner tracks the platform offset (ox = plat) so it doesn't
    // float loose when the platform shifts at damage state 2.
    // ----------------------------------------------------------------
    const ox = plat; // gunner horizontal anchor follows the platform

    // Boots — dark, barely visible nubs below the pants
    ctx.fillStyle = '#1a2010';
    ctx.fillRect(ox - 4, -32, 3, 2); // left boot
    ctx.fillRect(ox + 1, -32, 3, 2); // right boot

    // Pants / lower body — dark olive green
    ctx.fillStyle = '#2a5020';
    ctx.fillRect(ox - 3, -36, 7, 4);

    // Torso — orc green armour vest with a central ridge seam
    ctx.fillStyle = '#3a7a2a';
    ctx.fillRect(ox - 5, -43, 10, 7);

    ctx.fillStyle = '#2a5020'; // darker centre seam / armour ridge
    ctx.fillRect(ox - 1, -43, 2, 7);

    // Head — solid green block
    ctx.fillStyle = '#3a7a2a';
    ctx.fillRect(ox - 3, -47, 6, 4);

    // Eye slit — dark visor with two red glow pixels inside
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(ox - 2, -45, 4, 1);

    ctx.fillStyle = '#cc2200'; // red eye glow
    ctx.fillRect(ox - 1, -45, 1, 1);
    ctx.fillRect(ox + 1, -45, 1, 1);

    // Brass shoulder augment — right side, rank & targeting hardware
    ctx.fillStyle = '#b87a20'; // warm brass
    ctx.fillRect(ox + 3, -43, 5, 5);

    ctx.fillStyle = '#d4a030'; // brass face highlight
    ctx.fillRect(ox + 4, -43, 2, 1);

    ctx.fillStyle = '#8a5810'; // darker brass rivet in the augment body
    ctx.fillRect(ox + 5, -40, 2, 2);

    // Neon fur plume — three tufts of bioluminescent fur on top of the helmet.
    // Plume size indicates rank: this is a basic emplacement operator (small plume).
    ctx.fillStyle = '#00ff88'; // bright neon green
    ctx.fillRect(ox - 2, -51, 2, 4); // left tuft
    ctx.fillRect(ox,     -53, 2, 6); // centre tuft (tallest)
    ctx.fillRect(ox + 2, -51, 2, 4); // right tuft

    ctx.fillStyle = '#00aa55'; // darker inner base of the plume
    ctx.fillRect(ox - 1, -50, 1, 3);
    ctx.fillRect(ox + 1, -52, 1, 4);

    // ----------------------------------------------------------------
    // Layer 5 — Cannon barrel
    // Chunky 6×22 px vertical barrel rising from the gunner's right shoulder.
    // Top at y = −62, base overlaps the shoulder augment at y = −40.
    // The left face is one shade lighter to suggest depth (pixel shading).
    // An L-shaped crank handle extends from the right side mid-barrel.
    // ----------------------------------------------------------------
    const bx = ox + 1; // barrel left edge

    ctx.fillStyle = '#1e1e1e'; // dark cannon iron — main barrel body
    ctx.fillRect(bx, -62, 6, 22);

    ctx.fillStyle = '#2e2e2e'; // slightly lighter left face — pixel shading
    ctx.fillRect(bx, -62, 2, 22);

    // Darker bore at the barrel mouth (tip of the cannon — faces the sky)
    ctx.fillStyle = '#080808';
    ctx.fillRect(bx, -62, 6, 2);

    // L-shaped crank handle on the right side, mid-barrel:
    //   Horizontal arm extends right from the barrel wall
    //   Vertical grip hangs down from the far end of the arm
    ctx.fillStyle = '#4a3828'; // dark brown machined handle
    ctx.fillRect(bx + 6, -54, 8, 2);  // horizontal arm
    ctx.fillRect(bx + 12, -54, 2, 6); // vertical grip at the arm tip

    // ----------------------------------------------------------------
    // Layer 6 — Power cell
    // 4×4 px Voidheart Ore shard clamped to the barrel body.
    // Purplish-red glow with a gold-vein highlight pixel — visually
    // matches the ore description in GAME_DESIGN.md.
    // ----------------------------------------------------------------
    ctx.fillStyle = '#8a2a7a'; // Voidheart Ore — purplish-red
    ctx.fillRect(bx + 1, -50, 4, 4);

    ctx.fillStyle = '#c4902a'; // gold vein running through the ore
    ctx.fillRect(bx + 2, -49, 1, 2);

    ctx.fillStyle = '#cc44bb'; // surface glow highlight
    ctx.fillRect(bx + 2, -50, 2, 1);

    ctx.restore();
  }

  // ================================================================
  // COLLAPSE ANIMATION
  // ================================================================

  // Called each render frame while the cannon is dead.
  // _collapseFrame is advanced by 1 each call; after frame 3 the
  // instance sets active = false and stops drawing entirely.
  //
  // Frame 1: structure fractures — large pieces fly outward
  // Frame 2: debris spreads further, base crumbles
  // Frame 3: everything flattened into ground-level rubble
  // Frame 4+: active = false (instance removed from scene)
  _renderCollapse(ctx, screenX, py) {
    ctx.save();
    ctx.translate(screenX, py);

    const f = this._collapseFrame;

    if (f === 1) {
      // Upper structure splits apart; largest pieces fly outward
      ctx.fillStyle = '#3a3030'; // leg iron chunks
      ctx.fillRect(-24, -28, 6, 4);  // left chunk launching left
      ctx.fillRect(18,  -22, 5, 3);  // right chunk launching right

      ctx.fillStyle = '#6a6060'; // platform slab tilting
      ctx.fillRect(-8, -22, 16, 3);

      ctx.fillStyle = '#3a7a2a'; // gunner tumbling left
      ctx.fillRect(-8, -18, 8, 6);

      ctx.fillStyle = '#1e1e1e'; // barrel section falling right
      ctx.fillRect(4,  -32, 4, 12);

      ctx.fillStyle = '#2a2828'; // base plate still standing
      ctx.fillRect(-16, -6, 32, 6);

      this._collapseFrame = 2;

    } else if (f === 2) {
      // Debris spreads further; power cell rolls free; base crumbles
      ctx.fillStyle = '#3a3030';
      ctx.fillRect(-32, -14, 8, 3);  // leg chunk further left
      ctx.fillRect(24,  -10, 6, 3);  // leg chunk further right

      ctx.fillStyle = '#3a7a2a'; // gunner near the ground
      ctx.fillRect(-16, -6, 7, 4);

      ctx.fillStyle = '#1e1e1e'; // barrel now horizontal on the right
      ctx.fillRect(10,  -10, 12, 3);

      ctx.fillStyle = '#8a2a7a'; // power cell loose on the ground
      ctx.fillRect(-4,  -8, 4, 4);

      ctx.fillStyle = '#2a2828'; // crumbling base, shorter
      ctx.fillRect(-14, -4, 28, 4);

      this._collapseFrame = 3;

    } else if (f === 3) {
      // Everything flattened into scattered ground-level rubble
      ctx.fillStyle = '#2a2828'; // flattened base slab debris
      ctx.fillRect(-18, -3, 36, 3);

      ctx.fillStyle = '#3a3030'; // scattered leg fragments
      ctx.fillRect(-32, -2, 10, 2);
      ctx.fillRect( 22, -2, 12, 2);

      ctx.fillStyle = '#3a7a2a'; // gunner flat
      ctx.fillRect(-18, -2, 8, 2);

      ctx.fillStyle = '#1e1e1e'; // barrel flat
      ctx.fillRect(  8, -2, 12, 2);

      ctx.fillStyle = '#8a2a7a'; // power cell on the ground
      ctx.fillRect( -2, -2, 4, 2);

      this._collapseFrame = 4;

    } else {
      // Animation complete — deactivate and stop drawing
      this.active = false;
    }

    ctx.restore();
  }

}
