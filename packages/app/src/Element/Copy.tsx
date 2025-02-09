import "./Copy.css";
import Icon from "Icons/Icon";
import { useCopy } from "useCopy";

export interface CopyProps {
  text: string;
  maxSize?: number;
  className?: string;
}
export default function Copy({ text, maxSize = 32, className }: CopyProps) {
  const { copy, copied } = useCopy();
  const sliceLength = maxSize / 2;
  const trimmed = text.length > maxSize ? `${text.slice(0, sliceLength)}...${text.slice(-sliceLength)}` : text;

  return (
    <div className={`flex flex-row copy ${className}`} onClick={() => copy(text)}>
      <span className="body">{trimmed}</span>
      <span className="icon" style={{ color: copied ? "var(--success)" : "var(--highlight)" }}>
        {copied ? <Icon name="check" size={14} /> : <Icon name="copy" size={14} />}
      </span>
    </div>
  );
}
