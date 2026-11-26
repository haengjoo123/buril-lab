/**
 * Shared class names for the agent result area, so every card follows one set
 * of rules. They were checked against the Astryx Component Audit Rubric and
 * Accessibility Checklist (ids in brackets); docs/operations/agent-mode-rollout.md
 * holds the item-by-item record.
 *
 * - Type [D6]: 18 / 14 / 12px for card title, body and row titles, and notes.
 *   Nothing is smaller than 12px, body text keeps a line height of 1.4+, and
 *   long text is held to 70ch.
 * - Spacing [D1, D2]: the 4px scale. 2-4px inside a label and its value, 4-8px
 *   between rows or a label and its control, 12-16px between groups, 16px
 *   around a card and between cards. An inner gap is never wider than the one
 *   around it.
 * - Radius by role [D4]: 4px badges, 8px blocks, 12px controls and the choice
 *   rows that sit 4px inside the card edge, 16px cards, full for pills.
 * - Surfaces [D11, D16]: a card is one bordered surface without a shadow, and
 *   nothing inside it is boxed again.
 * - Interaction [D9, B2, A20, A21]: hover and selection are translucent tints
 *   over what lies beneath. Tailwind applies hover: only where the device can
 *   hover, so a tap leaves nothing stuck. A disabled control paints no hover
 *   and keeps the default cursor.
 * - Colour [D7, D10, A14]: every text and background pair meets WCAG AA in
 *   both themes; an outcome is an icon plus words, never colour alone; chosen
 *   states stay visible when the system forces its own colours.
 * - Motion [D12, A13]: colour transitions and a 0.98 press on buttons only,
 *   all switched off for reduced motion.
 * - Layout [R2, I8]: cards adapt to their own width, not the window's, and use
 *   logical (start/end) properties.
 */

/** Keyboard focus on any control in a card: a 2px accent outline set off from the control. */
export const AGENT_FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:focus-visible:outline-blue-400';
/** The same outline on a row whose native input holds the focus. */
const FOCUS_WITHIN = 'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-600 dark:has-[:focus-visible]:outline-blue-400';
const MOTION = 'transition-colors duration-150 motion-reduce:transition-none';
/** A translucent tint over whatever lies beneath. Only an enabled control paints it. */
const HOVER_TINT = 'enabled:hover:bg-slate-900/5 dark:enabled:hover:bg-white/10';
const PRESSED = 'enabled:active:scale-[0.98] motion-reduce:enabled:active:scale-100';
const DISABLED = 'disabled:cursor-default disabled:opacity-50';
/** Busy is not disabled: the control keeps the focus and its look, and only stops answering the pointer. */
const BUSY = 'aria-disabled:pointer-events-none';

/** Space between the parts of one answer: the interpretation line, the card and its footnote. */
export const AGENT_STACK = 'flex flex-col gap-4';
/** A container for its own contents, so the layout inside follows the card's width. */
export const AGENT_CARD = '@container rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800';
export const AGENT_CARD_TITLE = 'text-lg font-semibold leading-7 text-slate-900 dark:text-slate-100';
/** Long text is held to a readable measure on wide screens. */
export const AGENT_PROSE = 'max-w-[70ch]';
export const AGENT_BODY = `${AGENT_PROSE} text-sm leading-6 text-slate-700 dark:text-slate-300`;
export const AGENT_NOTE = `${AGENT_PROSE} text-sm leading-6 text-slate-600 dark:text-slate-400`;
export const AGENT_FOOTNOTE = `${AGENT_PROSE} text-xs leading-5 text-slate-500 dark:text-slate-400`;
export const AGENT_ROW = 'border-t border-slate-100 py-3 first:border-t-0 first:pt-0 last:pb-0 dark:border-slate-700/60';
export const AGENT_ROW_TITLE = 'break-words text-sm font-semibold leading-6 text-slate-900 dark:text-slate-100';
export const AGENT_ROW_META = 'break-words text-sm leading-6 text-slate-600 dark:text-slate-400';
/** A value that stands on its own line under a label. */
export const AGENT_VALUE = 'break-words text-sm font-medium leading-6 text-slate-900 dark:text-slate-100';
export const AGENT_SUB_HEADING = 'mb-2 mt-4 text-sm font-medium text-slate-600 first:mt-0 dark:text-slate-400';
export const AGENT_FIELD_LABEL = 'text-sm font-medium text-slate-600 dark:text-slate-400';
/** A label and its value inside a row, with no box of their own. */
export const AGENT_FACT_LABEL = 'text-xs font-medium leading-6 text-slate-500 dark:text-slate-400';

const BADGE = 'inline-block rounded px-1.5 py-0.5 text-xs font-semibold';
export const AGENT_CHIP = `${BADGE} bg-slate-100 font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200`;
/** Badges that carry a level. Each also carries its level in words. */
export const AGENT_BADGE = {
  danger: `${BADGE} bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200`,
  warning: `${BADGE} bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200`,
  ok: `${BADGE} bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200`,
} as const;

/** The transparent border becomes the button's edge when the system forces its own colours. */
const BUTTON = `relative inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-transparent px-4 text-sm font-semibold ${MOTION} ${PRESSED} ${DISABLED} ${BUSY} ${AGENT_FOCUS}`;
/**
 * The one action a card is about; a card never has two. Hover darkens it with
 * a translucent layer over the accent rather than swapping the fill.
 */
export const AGENT_PRIMARY_BUTTON = `${BUTTON} bg-blue-600 from-slate-950/15 to-slate-950/15 text-white enabled:hover:bg-linear-to-b dark:from-white/15 dark:to-white/15`;
export const AGENT_SECONDARY_BUTTON = `${BUTTON} border-slate-300 text-slate-700 ${HOVER_TINT} dark:border-slate-600 dark:text-slate-200`;
/** The way out of a proposal: present, but never competing with the button that records. */
export const AGENT_QUIET_BUTTON = `${BUTTON} text-slate-600 ${HOVER_TINT} aria-disabled:opacity-50 dark:text-slate-300`;
export const AGENT_LINK_BUTTON = `inline-flex min-h-11 items-center gap-1.5 rounded text-sm font-medium text-blue-700 underline-offset-4 hover:underline dark:text-blue-300 ${AGENT_FOCUS}`;
/** A suggested request: a pill, because it is something to tap rather than a setting. */
export const AGENT_SUGGESTION = `inline-flex min-h-11 max-w-full items-center rounded-full border border-slate-300 px-4 text-sm text-slate-700 ${MOTION} ${HOVER_TINT} ${PRESSED} dark:border-slate-600 dark:text-slate-200 ${AGENT_FOCUS}`;
/** An arrow that points the way the text runs. */
export const AGENT_DIRECTIONAL_ICON = 'h-4 w-4 shrink-0 rtl:-scale-x-100';

/**
 * One option in a single-choice or multiple-choice list. The whole row is the
 * target around a native radio or checkbox, which carries the state. A chosen
 * row is tinted rather than boxed; the row sits 4px inside the card edge, so
 * its 12px corners follow the card's 16px ones.
 */
export const AGENT_CHOICE = `flex min-h-11 cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 ${MOTION} ${FOCUS_WITHIN} has-[:disabled]:cursor-default has-[:disabled]:opacity-60`;
/** A row is either waiting to be chosen (tinted on hover) or chosen (tinted throughout); never both. */
export const AGENT_CHOICE_IDLE = 'has-[:enabled]:hover:bg-slate-900/5 has-[:enabled]:active:bg-slate-900/10 dark:has-[:enabled]:hover:bg-white/10 dark:has-[:enabled]:active:bg-white/15';
export const AGENT_CHOICE_SELECTED = 'bg-blue-600/10 dark:bg-blue-400/15 forced-colors:outline forced-colors:outline-1 forced-colors:outline-[Highlight]';
export const AGENT_CHOICE_INPUT = 'mt-1 h-4 w-4 shrink-0 accent-blue-600 dark:accent-blue-400';
/**
 * One step of a short scale, such as how much is left: a label around a hidden
 * native radio, so arrow keys move through the scale. The chosen step is filled,
 * with the system's own highlight colours when those are forced.
 */
export const AGENT_SCALE_STEP = `flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-1 py-1 text-center text-xs font-semibold leading-snug ${MOTION} ${FOCUS_WITHIN} has-[:disabled]:cursor-default has-[:disabled]:opacity-50`;
export const AGENT_SCALE_STEP_IDLE = 'border-slate-300 text-slate-700 has-[:enabled]:hover:bg-slate-900/5 dark:border-slate-600 dark:text-slate-200 dark:has-[:enabled]:hover:bg-white/10';
export const AGENT_SCALE_STEP_SELECTED = 'border-blue-600 bg-blue-600 text-white forced-color-adjust-none forced-colors:border-[Highlight] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]';

/** An outcome inside a card: tinted surface, matching text and an icon, never colour alone. */
const STATUS = 'flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm leading-6';
export const AGENT_STATUS_SUCCESS = `${STATUS} bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100`;
export const AGENT_STATUS_ERROR = `${STATUS} bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100`;

/** A placeholder line while an answer is being prepared. */
export const AGENT_SKELETON_LINE = 'h-4 rounded bg-slate-200 motion-safe:animate-pulse dark:bg-slate-700';
/** A spinner that stands still for people who asked for less motion; the words beside it say what is happening. */
export const AGENT_SPINNER = 'h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none';
