import { useEffect, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { DISPLAY_DATE_PLACEHOLDER, formatISODateToDisplay, parseDisplayDate } from '../../utils/dateTime';

function isoFromUserText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return parseDisplayDate(trimmed) ?? (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null);
}

export function DisplayDateInput({
  value,
  onChange,
  onBlur,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onChange: (isoDate: string) => void;
}) {
  const [text, setText] = useState(() => (value ? formatISODateToDisplay(value) : ''));

  useEffect(() => {
    setText(value ? formatISODateToDisplay(value) : '');
  }, [value]);

  const commit = () => {
    const iso = isoFromUserText(text);
    if (iso === null) {
      setText(value ? formatISODateToDisplay(value) : '');
      return;
    }
    onChange(iso);
    setText(iso ? formatISODateToDisplay(iso) : '');
  };

  const { className = '', placeholder, ...rest } = props;

  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder={placeholder ?? DISPLAY_DATE_PLACEHOLDER}
      className={`form-control ${className}`}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={(event) => {
        commit();
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
        props.onKeyDown?.(event);
      }}
    />
  );
}
