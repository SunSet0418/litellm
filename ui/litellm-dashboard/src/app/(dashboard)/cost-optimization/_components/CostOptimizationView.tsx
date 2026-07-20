"use client";

import React, { useEffect, useMemo, useState } from "react";
import { PiggyBank } from "lucide-react";

import { AreaChart, BarChart, DonutChart, DEFAULT_COLOR_CYCLE } from "@/components/shared/charts";
import AdvancedDatePicker from "@/components/shared/advanced_date_picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getToolSpend, ToolSpendResponse, userDailyActivityCall } from "@/components/networking";
import { DailyData, SpendMetrics } from "@/components/UsagePage/types";
import { formatNumberWithCommas } from "@/utils/dataUtils";
import { all_admin_roles } from "@/utils/roles";
import { usePaginatedDailyActivity } from "@/app/(dashboard)/usage/_components/hooks/usePaginatedDailyActivity";
import { buildDailyToolSeries, computeCacheLeakage, topToolsBySpend } from "./costOptimizationUtils";

interface CostOptimizationViewProps {
  accessToken: string | null;
  userId: string | null;
  userRole: string;
}

type DateRange = { from?: Date; to?: Date };

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const EMPTY_TOOL_SPEND: ToolSpendResponse = {
  by_tool: [],
  daily: [],
  total_spend: 0,
  start_date: null,
  end_date: null,
};

const usd = (value: number): string => {
  const decimals = value > 0 && value < 1 ? 4 : 2;
  return `$${formatNumberWithCommas(value, decimals)}`;
};

const pct = (ratio: number): string => `${formatNumberWithCommas(ratio * 100, 1)}%`;

const shortDate = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

const compressionOf = (m: SpendMetrics): number => m.compression_savings_spend ?? 0;
const cachingOf = (m: SpendMetrics): number => m.prompt_caching_savings_spend ?? 0;
const savedTokensOf = (m: SpendMetrics): number => m.compression_saved_tokens ?? 0;

const SummaryCard = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <Card>
    <CardHeader>
      <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
    </CardHeader>
    <CardContent>
      <p className="text-2xl font-semibold text-foreground">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </CardContent>
  </Card>
);

const CostOptimizationView: React.FC<CostOptimizationViewProps> = ({ accessToken, userId, userRole }) => {
  const initialFrom = useMemo(() => new Date(new Date().getTime() - THIRTY_DAYS_MS), []);
  const initialTo = useMemo(() => new Date(), []);
  const [dateValue, setDateValue] = useState<DateRange>({ from: initialFrom, to: initialTo });

  const startTime = dateValue.from ?? null;
  const endTime = dateValue.to ?? null;
  const isAdmin = all_admin_roles.includes(userRole);
  const effectiveUserId = isAdmin ? null : userId;

  const { data, loading, isFetchingMore } = usePaginatedDailyActivity({
    fetchFn: userDailyActivityCall,
    args: [accessToken, startTime, endTime, effectiveUserId],
    enabled: !!accessToken && !!startTime && !!endTime,
  });

  const results = data.results as DailyData[];

  const toolSpendEnabled = !!accessToken && !!startTime && !!endTime;
  const rangeKey = startTime && endTime ? `${isoDay(startTime)}|${isoDay(endTime)}` : "";
  const [toolSpendState, setToolSpendState] = useState<{ key: string; data: ToolSpendResponse } | null>(null);

  useEffect(() => {
    if (!accessToken || !startTime || !endTime) return;
    let cancelled = false;
    getToolSpend(accessToken, isoDay(startTime), isoDay(endTime))
      .then((res) => {
        if (!cancelled) setToolSpendState({ key: rangeKey, data: res });
      })
      .catch(() => {
        if (!cancelled) setToolSpendState({ key: rangeKey, data: EMPTY_TOOL_SPEND });
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, startTime, endTime, rangeKey]);

  const toolSpend = toolSpendState?.key === rangeKey ? toolSpendState.data : null;
  const toolSpendLoading = toolSpendEnabled && toolSpend === null;

  const compressionTotal = useMemo(() => results.reduce((sum, d) => sum + compressionOf(d.metrics), 0), [results]);
  const cachingTotal = useMemo(() => results.reduce((sum, d) => sum + cachingOf(d.metrics), 0), [results]);
  const savedTokensTotal = useMemo(() => results.reduce((sum, d) => sum + savedTokensOf(d.metrics), 0), [results]);
  const totalSaved = compressionTotal + cachingTotal;

  const overTime = useMemo(
    () =>
      results.map((d) => ({
        date: shortDate(d.date),
        Compression: compressionOf(d.metrics),
        "Prompt caching": cachingOf(d.metrics),
      })),
    [results],
  );

  const byDriver = useMemo(
    () =>
      [
        { driver: "Compression", usd: compressionTotal },
        { driver: "Prompt caching", usd: cachingTotal },
      ].filter((d) => d.usd > 0),
    [compressionTotal, cachingTotal],
  );

  const leakage = useMemo(() => computeCacheLeakage(results), [results]);

  const topTools = useMemo(() => topToolsBySpend(toolSpend?.by_tool ?? []), [toolSpend]);
  const topToolNames = useMemo(() => topTools.map((t) => t.tool_name), [topTools]);
  const dailyToolSeries = useMemo(
    () =>
      buildDailyToolSeries(toolSpend?.daily ?? [], topToolNames).map((point) => ({
        ...point,
        date: shortDate(String(point.date)),
      })),
    [toolSpend, topToolNames],
  );
  const toolColors = useMemo(() => DEFAULT_COLOR_CYCLE.slice(0, Math.max(topToolNames.length, 1)), [topToolNames]);

  return (
    <div className="w-full space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <PiggyBank className="size-6 text-emerald-600" strokeWidth={1.75} />
            <h1 className="text-xl font-semibold text-foreground">Cost Optimization</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Money saved by prompt compression and prompt caching across your requests
          </p>
        </div>
        <AdvancedDatePicker value={dateValue} onValueChange={(v) => setDateValue(v)} />
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryCard
          label="Total saved"
          value={usd(totalSaved)}
          hint={loading || isFetchingMore ? "Loading..." : "Compression + prompt caching"}
        />
        <SummaryCard
          label="Compression savings"
          value={usd(compressionTotal)}
          hint={`${formatNumberWithCommas(savedTokensTotal)} tokens compressed`}
        />
        <SummaryCard label="Prompt caching savings" value={usd(cachingTotal)} hint="Cache read discount" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Savings over time</CardTitle>
          </CardHeader>
          <CardContent>
            <AreaChart
              data={overTime}
              index="date"
              categories={["Compression", "Prompt caching"]}
              colors={["emerald", "blue"]}
              valueFormatter={usd}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Savings by driver</CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart
              className="h-80"
              data={byDriver}
              index="driver"
              category="usd"
              colors={["emerald", "blue"]}
              valueFormatter={usd}
              showLabel
              label={usd(totalSaved)}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cache leakage by virtual key</CardTitle>
          <p className="text-sm text-muted-foreground">
            Keys sending large volumes of uncached prompt tokens with a low cache-hit ratio are likely missing prompt
            caching. Estimated savings left is approximate: uncached prompt tokens priced at the portfolio&apos;s
            realized cache-read discount.
          </p>
        </CardHeader>
        <CardContent>
          {leakage.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {loading || isFetchingMore ? "Loading..." : "No key usage in this range."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead className="text-right">Uncached prompt tokens</TableHead>
                  <TableHead className="text-right">Cache hit ratio</TableHead>
                  <TableHead className="text-right">Realized caching savings</TableHead>
                  <TableHead className="text-right">Est. savings left</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leakage.rows.map((row) => (
                  <TableRow key={row.apiKey}>
                    <TableCell className="font-medium">
                      {row.keyAlias || `${row.apiKey.slice(0, 8)}...`}
                      {row.teamId && <span className="ml-1 text-xs text-muted-foreground">({row.teamId})</span>}
                    </TableCell>
                    <TableCell className="text-right">{formatNumberWithCommas(row.uncachedPromptTokens)}</TableCell>
                    <TableCell className="text-right">{pct(row.cacheHitRatio)}</TableCell>
                    <TableCell className="text-right">{usd(row.realizedCachingSavings)}</TableCell>
                    <TableCell className="text-right">
                      {row.estSavingsLeft == null ? "—" : usd(row.estSavingsLeft)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Spend by tool</CardTitle>
          <p className="text-sm text-muted-foreground">
            Spend on requests that called each tool (MCP and client-side tools). A request that used multiple tools
            counts its full spend toward each, so this attributes rather than partitions spend.
          </p>
        </CardHeader>
        <CardContent>
          {topTools.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {toolSpendLoading ? "Loading..." : "No tool usage in this range."}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-medium text-muted-foreground">Total by tool</p>
                <BarChart
                  data={topTools}
                  index="tool_name"
                  categories={["spend"]}
                  colors={["emerald"]}
                  layout="vertical"
                  yAxisWidth={140}
                  showLegend={false}
                  valueFormatter={usd}
                />
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-muted-foreground">Daily spend by tool</p>
                <BarChart
                  data={dailyToolSeries}
                  index="date"
                  categories={topToolNames}
                  colors={toolColors}
                  stack
                  valueFormatter={usd}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CostOptimizationView;
