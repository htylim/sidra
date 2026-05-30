import { useEffect, useState } from "react";
import { SidraIcon } from "./sidra-icon";

export type CurrentPageCardProps = {
  title: string;
  statusLabel: string;
  favIconUrl?: string;
};

export function CurrentPageCard(props: CurrentPageCardProps) {
  const [faviconFailed, setFaviconFailed] = useState(false);
  const showFavicon = Boolean(props.favIconUrl) && !faviconFailed;

  useEffect(() => {
    setFaviconFailed(false);
  }, [props.favIconUrl]);

  return (
    <section className="page-card" aria-label="Current page">
      <div className="page-icon">
        {showFavicon ? (
          <img
            alt=""
            aria-hidden="true"
            className="page-favicon"
            src={props.favIconUrl}
            onError={() => setFaviconFailed(true)}
          />
        ) : (
          <SidraIcon name="file-text" />
        )}
      </div>
      <div className="page-copy">
        <div className="page-title" title={props.title}>
          {props.title}
        </div>
        <div className="page-status">{props.statusLabel}</div>
      </div>
    </section>
  );
}
