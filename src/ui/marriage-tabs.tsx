import { marriageTabs } from "./nav.ts";
import type { Screen } from "./routes.ts";
import { SpaceTabs } from "./space-tabs.tsx";
import { text } from "./text.ts";

export const MarriageTabs = ({ screen }: { screen: Screen }) => <SpaceTabs tabs={marriageTabs} label={text.marriage.label} screen={screen} />;
