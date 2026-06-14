import { Op } from "@prodkit/op";
import type { HKT } from "@prodkit/op/hkt";
import { Policy } from "@prodkit/op/policy";
import { Result } from "better-result";

export type MaintenanceMode = "scheduled" | "emergency";

export type MaintenanceBlocked<Mode extends MaintenanceMode = MaintenanceMode> = {
  readonly _tag: "MaintenanceBlocked";
  readonly mode: Mode;
};

interface MaintenanceGatePolicyType<Mode extends MaintenanceMode> extends HKT {
  readonly [HKT.TYPE]: Op<
    HKT.Param<this, 0>,
    HKT.Param<this, 1> | MaintenanceBlocked<Mode>,
    HKT.Param<this, 2>,
    HKT.Param<this, 3>
  >;
}

export function maintenanceGate<Mode extends MaintenanceMode>(
  active: boolean,
  mode: Mode,
): Policy<unknown, MaintenanceGatePolicyType<Mode>> {
  return Policy.define<unknown, MaintenanceGatePolicyType<Mode>>({
    apply: (source) => {
      if (active) {
        return source.around(async () => {
          return Result.err({ _tag: "MaintenanceBlocked", mode } as const);
        });
      }

      return source.around((next, context) => next(context));
    },
  });
}

export function createApp() {
  const fetchDashboard = Op(function* (userId: string) {
    return { userId, widgets: ["orders", "messages"] as const };
  });

  const loadDashboard = (maintenanceActive: boolean, mode: MaintenanceMode = "scheduled") =>
    fetchDashboard.with(maintenanceGate(maintenanceActive, mode));

  return { loadDashboard };
}
