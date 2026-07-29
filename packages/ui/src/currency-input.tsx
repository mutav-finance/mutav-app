import { Input } from "./input";

export function CurrencyInput({
  value,
  onChange,
  onBlur,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <span className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2 text-sm select-none">
        R$
      </span>
      <Input
        className="pl-8"
        value={value}
        placeholder={placeholder}
        inputMode="decimal"
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur ? (e) => onBlur(e.target.value) : undefined}
      />
    </div>
  );
}
