import { Op, type Op as OpType } from "@prodkit/op";
import type { HKT } from "@prodkit/op/hkt";
import { Policy, type OpPolicy } from "@prodkit/op/policy";
import { Result } from "better-result";

export type MaintenanceMode = "scheduled" | "emergency";

export type MaintenanceBlocked = {
  readonly _tag: "MaintenanceBlocked";
  readonly mode: MaintenanceMode;
};

interface MaintenanceGatePolicyType<Mode extends MaintenanceMode> extends HKT {
  readonly [HKT.TYPE]: OpType<
    HKT.Param<this, 0>,
    HKT.Param<this, 1> | MaintenanceBlocked,
    HKT.Param<this, 2>,
    HKT.Param<this, 3>
  >;
}

export function maintenanceGate<Mode extends MaintenanceMode>(
  active: boolean,
  mode: Mode,
): OpPolicy<unknown, MaintenanceGatePolicyType<Mode>> {
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
