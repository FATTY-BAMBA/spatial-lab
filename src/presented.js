// T-011: the style and finishes the designer presents, saved on the project (spatial_projects.doc.presented) so the
// client's share link and the 提案書 open on them. Pure, no DOM, so qa/unit can check it.
//   doc.presented = { v: 1, style: 'wabi' | null (null = a custom mix), palette: style id whose fabrics/light it uses,
//                     finishes: { group: option }, at: ISO time }

/** A presented choice to save: the current style (null for a custom mix) and every finish group's option. */
export function makePresented(styleId, chosen, paletteId = null, now = new Date()) {
  return { v: 1, style: styleId || null, palette: styleId || paletteId || null, finishes: { ...chosen }, at: now.toISOString() };
}

/** Checked against this plan and its styles: unknown groups, options and styles are dropped; null when unusable. */
export function normPresented(p, plan, styleIds = []) {
  if (!p || typeof p !== 'object' || !p.finishes || typeof p.finishes !== 'object') return null;
  const finishes = {};
  for (const g of plan.finishes || []) {
    const o = p.finishes[g.id];
    if (typeof o === 'string' && g.options.some(x => x.id === o)) finishes[g.id] = o;
  }
  if (!Object.keys(finishes).length) return null;
  const known = x => (typeof x === 'string' && styleIds.includes(x) ? x : null);
  const style = known(p.style);
  // a custom mix keeps the palette (fabrics, light) of the style it was made from
  return { v: 1, style, palette: style || known(p.palette), finishes, at: typeof p.at === 'string' ? p.at.slice(0, 40) : '' };
}

/**
 * What a saved project opens on. The designer's saved choice wins unless this browser already made its own choice
 * after seeing that same saved choice (`seen` = the `at` it last applied): a client who switched style on their phone
 * keeps their switch on reload, until the designer presents something new.
 */
export const usePresented = (presented, seen) => !!presented && presented.at !== seen;

/** True when the current choice differs from the presented one (the client switched away from the designer's pick). */
export function differs(presented, styleId, chosen) {
  if (!presented) return false;
  if ((presented.style || null) !== (styleId || null)) return true;
  return Object.entries(presented.finishes).some(([g, o]) => chosen[g] !== o);
}
