import type { ReactNode, HTMLAttributes, ThHTMLAttributes, TdHTMLAttributes } from 'react';

// Dense Binance-style table primitive. Composition pattern — render
// `<Table>` with header rows of `<THead><TR><TH>...</TH>...</TR></THead>`
// and body rows of `<TBody><TR onClick=...><TD>...</TD>...</TR></TBody>`.
//
// Rows default to 32 px tall. Hover shifts background one step. Selected
// rows get a 2 px yellow left edge and `bg-row-active`. The `flash`
// prop on TR runs the 400 ms cell-flash keyframe defined in globals.css
// (`@keyframes trade-flash`) — toggle by setting `flash` true for one
// render then resetting to false.

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  children: ReactNode;
  className?: string;
}

export function Table({ children, className = '', ...rest }: TableProps) {
  return (
    <div className={`w-full overflow-x-auto ${className}`}>
      <table
        className="w-full border-collapse text-[12px] text-[#eaecef]"
        style={{ fontVariantNumeric: 'tabular-nums' }}
        {...rest}
      >
        {children}
      </table>
    </div>
  );
}

export function THead({ children, className = '', ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={`sticky top-0 z-10 bg-[#181a20] text-[10px] uppercase tracking-wider text-[#5e6673] ${className}`}
      {...rest}
    >
      {children}
    </thead>
  );
}

export function TBody({ children, className = '', ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={className} {...rest}>
      {children}
    </tbody>
  );
}

export interface TRProps extends HTMLAttributes<HTMLTableRowElement> {
  selected?: boolean;
  flash?: boolean;
  actionable?: boolean;       // adds 2px yellow left edge (pending action)
  children: ReactNode;
  className?: string;
}

export function TR({
  selected = false,
  flash = false,
  actionable = false,
  onClick,
  className = '',
  children,
  ...rest
}: TRProps) {
  const isClickable = Boolean(onClick);
  return (
    <tr
      data-flash={flash ? 'on' : undefined}
      onClick={onClick}
      className={[
        'border-b border-[#1e2026] transition-colors',
        selected ? 'bg-[#2b3139]' : 'hover:bg-[#1e2026]',
        isClickable ? 'cursor-pointer' : '',
        actionable ? 'border-l-2 border-l-[#fcd535]' : '',
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </tr>
  );
}

export interface THProps extends ThHTMLAttributes<HTMLTableCellElement> {
  align?: 'left' | 'right' | 'center';
  className?: string;
  children?: ReactNode;
}

export function TH({ align = 'left', className = '', children, ...rest }: THProps) {
  const alignClass =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th
      className={`px-3 py-2 font-medium whitespace-nowrap ${alignClass} ${className}`}
      {...rest}
    >
      {children}
    </th>
  );
}

export interface TDProps extends TdHTMLAttributes<HTMLTableCellElement> {
  align?: 'left' | 'right' | 'center';
  mono?: boolean;
  muted?: boolean;
  className?: string;
  children?: ReactNode;
}

export function TD({
  align = 'left',
  mono = false,
  muted = false,
  className = '',
  children,
  ...rest
}: TDProps) {
  const alignClass =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  const fontClass = mono ? 'font-mono' : '';
  const colorClass = muted ? 'text-[#b7bdc6]' : '';
  return (
    <td
      className={`px-3 py-1.5 whitespace-nowrap ${alignClass} ${fontClass} ${colorClass} ${className}`}
      {...rest}
    >
      {children}
    </td>
  );
}

export default Table;
