/**
 * Who did what, in what institutional position, and when.
 *
 * The **position** is not decoration next to the name. A decision on an
 * institutional record is taken by a seat, not by a person — the same human may
 * hold a different seat next term, and the record has to keep saying which one
 * was acting. So every line here reads "name · position · time", never just a
 * name, and that is the one rule this component exists to enforce.
 *
 * Renders nothing when there is nothing recorded, rather than an empty frame.
 */

function when(at) {
  if (!at) return null;
  return at.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function AuditHistory({ entries }) {
  if (!entries || entries.length === 0) return null;

  return (
    <ul className="m-0 p-0 list-none">
      {entries.map((e, i) => (
        <li
          // eslint-disable-next-line react/no-array-index-key -- audit lines have no id of their own and are never reordered
          key={i}
          className="py-[7px] border-t border-line-light first:border-t-0"
        >
          <div className="text-[12.5px] text-ink">{e.action}</div>
          <div className="mt-[1px] text-[11.5px] text-ink-faint">
            {e.by} · {e.position} · {when(e.at)}
          </div>
          {e.note && <div className="mt-[3px] text-[12px] text-ink-muted">{e.note}</div>}
        </li>
      ))}
    </ul>
  );
}
