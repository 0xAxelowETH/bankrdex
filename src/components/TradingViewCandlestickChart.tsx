import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useApp } from '../context/AppContext';
import { useSocial } from '../context/SocialContext';
import { FEATURES } from '../config/features';
import { Candle } from '../types';
import {
  BankrChartTimeframe,
  fetchBinanceTokenCandles,
  fetchBankrPoolOhlcv,
  fetchIndexedCandles,
  readCachedBankrPoolOhlcv,
} from '../services/tradingApis';
import type { ChainKey } from '../config/chains';
import { formatCurrency } from '../utils/web3';
import { OkxTokenLogo } from './OkxTokenLogo';
import { BrandLogo } from './BrandLogo';
import {
  Activity,
  ArrowDownToLine,
  Eye,
  Lightbulb,
  LineChart,
  Maximize2,
  Minimize2,
  PlusCircle,
  Save,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

type Timeframe = BankrChartTimeframe;

interface ChartLayout {
  timeframe: Timeframe;
  metric?: ChartMetric;
  chartStyle?: ChartStyle;
  showEma: boolean;
  showRsi: boolean;
  showVolume?: boolean;
  showTradeMarkers: boolean;
  showThesisLines: boolean;
}

type ChartMetric = 'price' | 'marketCap';
type ChartStyle = 'candles' | 'line';

const timeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1D'];

async function fetchChartCandles(
  poolAddress: string | undefined,
  tokenAddress: string,
  timeframe: Timeframe,
  signal: AbortSignal,
  limit: number,
  tokenSide: 'base' | 'quote',
  chain: ChainKey = 'base'
): Promise<{ candles: Candle[]; source: 'index' | 'gecko' | 'binance' }> {
  // Base: candles from the on-chain index (every swap), then GeckoTerminal.
  if (chain === 'base' && tokenSide === 'base') {
    try {
      const indexed = await fetchIndexedCandles(tokenAddress, timeframe, limit, signal);
      if (indexed.length > 1) return { candles: indexed, source: 'index' };
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }
  if (poolAddress) {
    try {
      const geckoCandles = await fetchBankrPoolOhlcv(poolAddress, timeframe, signal, limit, tokenSide, chain);
      if (geckoCandles.length > 0) return { candles: geckoCandles, source: 'gecko' };
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }
  // No GeckoTerminal-readable pool (e.g. a pool GeckoTerminal has not indexed yet) or Gecko failed:
  // fall back to Binance Web3 token candles (wired up for Base only).
  if (chain !== 'base') return { candles: [], source: 'gecko' };
  const binanceCandles = await fetchBinanceTokenCandles(tokenAddress, timeframe, signal, limit);
  return { candles: binanceCandles, source: 'binance' };
}

function readChartLayout(tokenId: string): ChartLayout | null {
  try {
    const value = localStorage.getItem(`bankrdex-chart-layout:${tokenId}`);
    return value ? JSON.parse(value) as ChartLayout : null;
  } catch {
    return null;
  }
}

const toChartTime = (timestamp: number) => Math.floor(timestamp / 1000) as UTCTimestamp;

function priceFormatFor(value: number, isMarketCap: boolean) {
  if (isMarketCap) {
    return {
      type: 'custom' as const,
      minMove: 0.01,
      formatter: (price: number) => formatCurrency(price, true, 2),
    };
  }

  const magnitude = value > 0 ? Math.floor(Math.log10(value)) : 0;
  const precision = Math.min(14, Math.max(2, 2 - magnitude));
  return {
    type: 'price' as const,
    precision,
    minMove: 10 ** -precision,
  };
}

export const TradingViewCandlestickChart: React.FC = () => {
  const {
    activeToken,
    recentTrades,
    activeThesis,
    theme,
    t,
  } = useApp();
  const { openComposer } = useSocial();

  const [timeframe, setTimeframe] = useState<Timeframe>('5m');
  const [chartMetric, setChartMetric] = useState<ChartMetric>('price');
  const [chartStyle, setChartStyle] = useState<ChartStyle>('candles');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [chartSource, setChartSource] = useState<'index' | 'gecko' | 'binance' | 'cached' | 'unavailable' | 'rate-limited' | 'loading'>('loading');
  const [chartUpdatedAt, setChartUpdatedAt] = useState<number | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [isSoftRefreshing, setIsSoftRefreshing] = useState(false);
  const [showEma, setShowEma] = useState(true);
  const [showRsi, setShowRsi] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [showTradeMarkers, setShowTradeMarkers] = useState(true);
  const [showThesisLines, setShowThesisLines] = useState(true);
  const [layoutSaved, setLayoutSaved] = useState(false);
  const [hoveredCandle, setHoveredCandle] = useState<Candle | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const thesisLinesRef = useRef<IPriceLine[]>([]);
  const candleByTimeRef = useRef<Map<number, Candle>>(new Map());
  const fittedRangeRef = useRef<string | null>(null);

  useEffect(() => {
    const layout = readChartLayout(activeToken.id);
    if (!layout) {
      setChartMetric('price');
      return;
    }
    if (timeframes.includes(layout.timeframe)) setTimeframe(layout.timeframe);
    setChartMetric(layout.metric || 'price');
    setChartStyle(layout.chartStyle === 'line' ? 'line' : 'candles');
    setShowEma(layout.showEma);
    setShowRsi(layout.showRsi);
    setShowVolume(layout.showVolume ?? true);
    setShowTradeMarkers(layout.showTradeMarkers);
    setShowThesisLines(layout.showThesisLines);
  }, [activeToken.id]);

  useEffect(() => {
    const controller = new AbortController();
    let isActive = true;
    let retryTimeout: number | undefined;
    const tokenSide = activeToken.poolTokenIsBase === false ? 'quote' : 'base';
    const cachedCandles = activeToken.poolAddress
      ? readCachedBankrPoolOhlcv(activeToken.poolAddress, timeframe, tokenSide, activeToken.chain)
      : [];
    setChartSource(cachedCandles.length > 0 ? 'cached' : 'loading');
    setCandles(cachedCandles);
    setChartUpdatedAt(null);
    setIsSoftRefreshing(true);

    const loadCandles = async () => {
      try {
        const result = await fetchChartCandles(
          activeToken.poolAddress,
          activeToken.address,
          timeframe,
          controller.signal,
          120,
          tokenSide,
          activeToken.chain
        );
        if (!isActive) return;
        if (result.candles.length === 0) {
          setChartSource('unavailable');
          retryTimeout = window.setTimeout(loadCandles, 60_000);
          return;
        }
        setCandles(result.candles);
        setChartUpdatedAt(Date.now());
        setChartSource(result.source);
      } catch (error) {
        if (!isActive || controller.signal.aborted) return;
        const isRateLimited = error instanceof Error && error.message.includes('(429)');
        setChartSource(isRateLimited ? 'rate-limited' : 'unavailable');
        retryTimeout = window.setTimeout(loadCandles, isRateLimited ? 60_000 : 30_000);
      } finally {
        if (isActive) setIsSoftRefreshing(false);
      }
    };

    void loadCandles();

    return () => {
      isActive = false;
      window.clearTimeout(retryTimeout);
      controller.abort();
    };
  }, [activeToken.address, activeToken.chain, activeToken.id, activeToken.poolAddress, activeToken.poolTokenIsBase, refreshNonce, timeframe]);

  useEffect(() => {
    const poolAddress = activeToken.poolAddress;
    if (chartSource !== 'index' && chartSource !== 'gecko' && chartSource !== 'binance' && chartSource !== 'cached' && chartSource !== 'rate-limited') return;

    let isActive = true;
    let isFetching = false;
    let timeoutId: number | undefined;
    let controller: AbortController | undefined;

    const refreshLatestCandles = async () => {
      if (!isActive || isFetching || document.visibilityState !== 'visible') return;
      isFetching = true;
      controller = new AbortController();

      try {
        const result = await fetchChartCandles(
          poolAddress,
          activeToken.address,
          timeframe,
          controller.signal,
          3,
          activeToken.poolTokenIsBase === false ? 'quote' : 'base',
          activeToken.chain
        );
        if (!isActive || result.candles.length === 0) return;

        setCandles((current) => {
          const candlesByTimestamp = new Map(current.map((candle) => [candle.timestamp, candle]));
          result.candles.forEach((candle) => candlesByTimestamp.set(candle.timestamp, candle));
          return [...candlesByTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp).slice(-120);
        });
        setChartUpdatedAt(Date.now());
        setChartSource(result.source);
      } catch {
        setChartSource('rate-limited');
      } finally {
        isFetching = false;
        if (isActive && document.visibilityState === 'visible') {
          timeoutId = window.setTimeout(refreshLatestCandles, 60_000);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !isFetching) {
        window.clearTimeout(timeoutId);
        void refreshLatestCandles();
      }
    };

    timeoutId = window.setTimeout(refreshLatestCandles, 60_000);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isActive = false;
      window.clearTimeout(timeoutId);
      controller?.abort();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeToken.address, activeToken.poolAddress, activeToken.poolTokenIsBase, chartSource, timeframe]);

  useEffect(() => {
    if ((chartSource !== 'index' && chartSource !== 'gecko' && chartSource !== 'binance') || chartUpdatedAt === null) return;
    const remainingMs = Math.max(0, 120_000 - (Date.now() - chartUpdatedAt));
    // Stale (tab in the background, or refreshes failing): reload the full history. Clearing
    // the candles here left only the few candles the incremental refresh fetches.
    const timeoutId = window.setTimeout(() => setRefreshNonce((nonce) => nonce + 1), remainingMs);
    return () => window.clearTimeout(timeoutId);
  }, [chartSource, chartUpdatedAt]);

  const hasFreshMarketSnapshot = Boolean(
    activeToken.liveSnapshotAt && Date.now() - activeToken.liveSnapshotAt < 120_000
  );
  const canPlotMarketCap = hasFreshMarketSnapshot && activeToken.priceUsd > 0 && activeToken.marketCapUsd > 0;
  const marketCapMultiplier = canPlotMarketCap ? activeToken.marketCapUsd / activeToken.priceUsd : 1;
  const isMarketCapChart = chartMetric === 'marketCap' && canPlotMarketCap;
  const displayCandles = useMemo(() => {
    if (!isMarketCapChart) return candles;
    return candles.map((candle) => ({
      ...candle,
      open: candle.open * marketCapMultiplier,
      high: candle.high * marketCapMultiplier,
      low: candle.low * marketCapMultiplier,
      close: candle.close * marketCapMultiplier,
    }));
  }, [candles, isMarketCapChart, marketCapMultiplier]);

  useEffect(() => {
    if (!canPlotMarketCap && chartMetric === 'marketCap') setChartMetric('price');
  }, [canPlotMarketCap, chartMetric]);

  const ema20 = useMemo(() => {
    if (displayCandles.length === 0) return [];
    const smoothing = 2 / 21;
    let previous = displayCandles[0].close;
    return displayCandles.map((candle, index) => {
      if (index === 0) return previous;
      previous = candle.close * smoothing + previous * (1 - smoothing);
      return previous;
    });
  }, [displayCandles]);

  const rsiValues = useMemo(() => {
    if (displayCandles.length < 15) return [];
    const period = 14;
    const values: (number | null)[] = Array(period).fill(null);
    let gains = 0;
    let losses = 0;

    for (let index = 1; index <= period; index++) {
      const difference = displayCandles[index].close - displayCandles[index - 1].close;
      if (difference >= 0) gains += difference;
      else losses += Math.abs(difference);
    }

    let averageGain = gains / period;
    let averageLoss = losses / period;
    values.push(100 - 100 / (1 + (averageLoss === 0 ? 100 : averageGain / averageLoss)));

    for (let index = period + 1; index < candles.length; index++) {
      const difference = displayCandles[index].close - displayCandles[index - 1].close;
      averageGain = (averageGain * (period - 1) + Math.max(difference, 0)) / period;
      averageLoss = (averageLoss * (period - 1) + Math.max(-difference, 0)) / period;
      values.push(100 - 100 / (1 + (averageLoss === 0 ? 100 : averageGain / averageLoss)));
    }

    return values;
  }, [displayCandles]);

  const relevantTrades = useMemo(
    () => recentTrades.filter((trade) => trade.tokenId === activeToken.id).slice(0, 15),
    [recentTrades, activeToken.id]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: theme === 'light' ? '#ffffff' : '#0a0c10' },
        textColor: theme === 'light' ? '#52606d' : '#989ba8',
        fontFamily: 'JetBrains Mono, monospace',
        attributionLogo: true,
        panes: {
          enableResize: true,
          separatorColor: theme === 'light' ? '#d5dbe1' : '#1c2129',
          separatorHoverColor: 'rgba(245, 158, 11, 0.28)',
        },
      },
      grid: {
        vertLines: { color: theme === 'light' ? '#e5e9ed' : '#151920' },
        horzLines: { color: theme === 'light' ? '#e5e9ed' : '#151920' },
      },
      rightPriceScale: { borderColor: theme === 'light' ? '#d5dbe1' : '#1c2129', scaleMargins: { top: 0.08, bottom: 0.2 } },
      timeScale: { borderColor: theme === 'light' ? '#d5dbe1' : '#1c2129', timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: theme === 'light' ? '#73808c' : '#7a7e87', style: LineStyle.Dashed, labelBackgroundColor: theme === 'light' ? '#52606d' : '#22282f' },
        horzLine: { color: theme === 'light' ? '#73808c' : '#7a7e87', style: LineStyle.Dashed, labelBackgroundColor: theme === 'light' ? '#52606d' : '#22282f' },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#2ef29a',
      downColor: '#ff4d6d',
      borderVisible: false,
      wickUpColor: '#2ef29a',
      wickDownColor: '#ff4d6d',
      priceLineColor: '#2ef29a',
      priceLineStyle: LineStyle.Dashed,
      lastValueVisible: true,
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const lineSeries = chart.addSeries(LineSeries, {
      color: '#2ef29a',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
    });

    const emaSeries = chart.addSeries(LineSeries, {
      color: '#c3ff2e',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    chart.addPane();
    const rsiPane = chart.panes()[1];
    rsiPane.setStretchFactor(0.22);
    const rsiSeries = chart.addSeries(LineSeries, {
      color: '#a855f7',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
      priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
    }, 1);
    rsiSeries.createPriceLine({ price: 70, color: '#55515d', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '' });
    rsiSeries.createPriceLine({ price: 30, color: '#55515d', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '' });

    const markers = createSeriesMarkers(candleSeries, []);
    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      const time = typeof param.time === 'number' ? param.time : null;
      setHoveredCandle(time === null ? null : candleByTimeRef.current.get(time) || null);
    };
    chart.subscribeCrosshairMove(handleCrosshairMove);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    lineSeriesRef.current = lineSeries;
    volumeSeriesRef.current = volumeSeries;
    emaSeriesRef.current = emaSeries;
    rsiSeriesRef.current = rsiSeries;
    markersRef.current = markers;

    let resizePointerId: number | null = null;
    let resizeStartY = 0;
    let resizeStartHeight = 0;
    let resizeTotalHeight = 0;
    const desktopResizeQuery = window.matchMedia('(min-width: 768px)');
    const handlePanePointerDown = (event: PointerEvent) => {
      if (!desktopResizeQuery.matches || !(event.target instanceof Element)) return;
      const handle = event.target.closest('tr > td[colspan="3"] > div:last-child');
      if (!handle) return;

      const panes = chart.panes();
      if (panes.length < 2) return;

      event.preventDefault();
      event.stopPropagation();
      resizePointerId = event.pointerId;
      resizeStartY = event.clientY;
      resizeStartHeight = panes[0].getHeight();
      resizeTotalHeight = panes.reduce((total, pane) => total + pane.getHeight(), 0);
      container.setPointerCapture(event.pointerId);
    };
    const handlePanePointerMove = (event: PointerEvent) => {
      if (resizePointerId !== event.pointerId) return;
      event.preventDefault();
      const panes = chart.panes();
      if (panes.length < 2) return;

      const nextHeight = Math.max(
        100,
        Math.min(resizeTotalHeight - 60, resizeStartHeight + event.clientY - resizeStartY)
      );
      panes[0].setHeight(nextHeight);
    };
    const finishPaneResize = (event: PointerEvent) => {
      if (resizePointerId !== event.pointerId) return;
      resizePointerId = null;
      if (container.hasPointerCapture(event.pointerId)) {
        container.releasePointerCapture(event.pointerId);
      }
    };

    container.addEventListener('pointerdown', handlePanePointerDown, true);
    container.addEventListener('pointermove', handlePanePointerMove, true);
    container.addEventListener('pointerup', finishPaneResize, true);
    container.addEventListener('pointercancel', finishPaneResize, true);

    return () => {
      container.removeEventListener('pointerdown', handlePanePointerDown, true);
      container.removeEventListener('pointermove', handlePanePointerMove, true);
      container.removeEventListener('pointerup', finishPaneResize, true);
      container.removeEventListener('pointercancel', finishPaneResize, true);
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      thesisLinesRef.current.forEach((priceLine) => candleSeries.removePriceLine(priceLine));
      markers.detach();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
      volumeSeriesRef.current = null;
      emaSeriesRef.current = null;
      rsiSeriesRef.current = null;
      markersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const updateRsiPaneSize = () => {
      chartRef.current?.panes()[1]?.setStretchFactor(
        showRsi ? (mediaQuery.matches ? 0.1 : 0.22) : 0.001
      );
    };

    updateRsiPaneSize();
    mediaQuery.addEventListener('change', updateRsiPaneSize);
    return () => mediaQuery.removeEventListener('change', updateRsiPaneSize);
  }, [showRsi]);

  useEffect(() => {
    chartRef.current?.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: theme === 'light' ? '#ffffff' : '#0a0c10' },
        textColor: theme === 'light' ? '#52606d' : '#989ba8',
      },
      grid: {
        vertLines: { color: theme === 'light' ? '#e5e9ed' : '#151920' },
        horzLines: { color: theme === 'light' ? '#e5e9ed' : '#151920' },
      },
      rightPriceScale: { borderColor: theme === 'light' ? '#d5dbe1' : '#1c2129' },
      timeScale: { borderColor: theme === 'light' ? '#d5dbe1' : '#1c2129' },
      crosshair: {
        vertLine: {
          color: theme === 'light' ? '#73808c' : '#7a7e87',
          labelBackgroundColor: theme === 'light' ? '#52606d' : '#22282f',
        },
        horzLine: {
          color: theme === 'light' ? '#73808c' : '#7a7e87',
          labelBackgroundColor: theme === 'light' ? '#52606d' : '#22282f',
        },
      },
    });
  }, [theme]);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const lineSeries = lineSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const emaSeries = emaSeriesRef.current;
    const rsiSeries = rsiSeriesRef.current;
    const markers = markersRef.current;
    const chart = chartRef.current;
    if (!candleSeries || !lineSeries || !volumeSeries || !emaSeries || !rsiSeries || !markers || !chart) return;
    const referencePrice = isMarketCapChart
      ? activeToken.marketCapUsd
      : activeToken.priceUsd > 0 ? activeToken.priceUsd : displayCandles.at(-1)?.close || 0;
    const priceFormat = priceFormatFor(referencePrice, isMarketCapChart);
    candleSeries.applyOptions({ priceFormat });
    lineSeries.applyOptions({ priceFormat });
    volumeSeries.applyOptions({ visible: showVolume });
    emaSeries.applyOptions({ priceFormat });

    const chartCandles = displayCandles.map((candle) => ({
      time: toChartTime(candle.timestamp),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
    candleByTimeRef.current = new Map(displayCandles.map((candle) => [Math.floor(candle.timestamp / 1000), candle]));
    candleSeries.setData(chartStyle === 'candles' ? chartCandles : []);
    lineSeries.setData(chartStyle === 'line'
      ? displayCandles.map((candle) => ({ time: toChartTime(candle.timestamp), value: candle.close }))
      : []);
    volumeSeries.setData(candles.map((candle) => ({
      time: toChartTime(candle.timestamp),
      value: candle.volume,
      color: candle.isUp ? 'rgba(16, 185, 129, 0.35)' : 'rgba(244, 63, 94, 0.35)',
    })));
    emaSeries.setData(showEma ? displayCandles.map((candle, index) => ({ time: toChartTime(candle.timestamp), value: ema20[index] })) : []);
    rsiSeries.setData(showRsi ? rsiValues.flatMap((value, index) => value === null ? [] : [{ time: toChartTime(displayCandles[index].timestamp), value }]) : []);
    markers.setMarkers(showTradeMarkers && displayCandles.length > 0 ? relevantTrades.map((trade, index) => {
      const candleIndex = Math.max(0, displayCandles.length - 1 - index * 2);
      const isBuy = trade.type === 'buy';
      return {
        id: trade.id,
        time: toChartTime(displayCandles[candleIndex].timestamp),
        position: isBuy ? 'belowBar' as const : 'aboveBar' as const,
        shape: isBuy ? 'arrowUp' as const : 'arrowDown' as const,
        color: isBuy ? '#2ef29a' : '#ff4d6d',
        text: isBuy ? 'B' : 'S',
        size: 1,
      } satisfies SeriesMarker<Time>;
    }) : []);

    thesisLinesRef.current.forEach((priceLine) => candleSeries.removePriceLine(priceLine));
    thesisLinesRef.current = [];
    candleSeries.applyOptions({ autoscaleInfoProvider: undefined });
    if (showThesisLines && activeThesis?.tokenId === activeToken.id) {
      const levels = [
        { price: activeThesis.targetPriceUsd * (isMarketCapChart ? marketCapMultiplier : 1), color: '#2ef29a', title: 'Target' },
        { price: activeThesis.entryPriceUsd * (isMarketCapChart ? marketCapMultiplier : 1), color: '#f59e0b', title: 'Entry' },
        { price: activeThesis.stopLossUsd * (isMarketCapChart ? marketCapMultiplier : 1), color: '#ff4d6d', title: 'Stop' },
      ].filter((level) => level.price > 0);
      // Keep target and stop on screen: widen the auto-scaled range to include every level.
      const low = Math.min(...levels.map((level) => level.price));
      const high = Math.max(...levels.map((level) => level.price));
      candleSeries.applyOptions({
        autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
          const range = original();
          if (!range?.priceRange) return range;
          return { ...range, priceRange: { minValue: Math.min(range.priceRange.minValue, low), maxValue: Math.max(range.priceRange.maxValue, high) } };
        },
      });
      thesisLinesRef.current = levels.map((level) => candleSeries.createPriceLine({
        price: level.price,
        color: level.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: level.title,
      }));
    }

    const rangeKey = `${activeToken.id}:${timeframe}:${isMarketCapChart ? 'marketCap' : 'price'}`;
    if (displayCandles.length > 0 && fittedRangeRef.current !== rangeKey) {
      chart.timeScale().fitContent();
      fittedRangeRef.current = rangeKey;
    }
  }, [
    activeToken.id,
    activeToken.marketCapUsd,
    activeToken.priceUsd,
    activeThesis,
    candles,
    displayCandles,
    ema20,
    isMarketCapChart,
    marketCapMultiplier,
    rsiValues,
    relevantTrades,
    showEma,
    showVolume,
    chartStyle,
    showRsi,
    showThesisLines,
    showTradeMarkers,
    timeframe,
  ]);

  const activeCandleDisplay = hoveredCandle || (displayCandles.length > 0 ? displayCandles[displayCandles.length - 1] : null);

  const saveLayout = useCallback(() => {
    const layout: ChartLayout = {
      timeframe,
      metric: chartMetric,
      chartStyle,
      showEma,
      showRsi,
      showVolume,
      showTradeMarkers,
      showThesisLines,
    };
    localStorage.setItem(`bankrdex-chart-layout:${activeToken.id}`, JSON.stringify(layout));
    setLayoutSaved(true);
    window.setTimeout(() => setLayoutSaved(false), 1800);
  }, [activeToken.id, chartMetric, chartStyle, showEma, showRsi, showThesisLines, showTradeMarkers, showVolume, timeframe]);

  const adjustZoom = useCallback((factor: number) => {
    const timeScale = chartRef.current?.timeScale();
    const range = timeScale?.getVisibleLogicalRange();
    if (!timeScale || !range) {
      timeScale?.fitContent();
      return;
    }

    const currentSpan = range.to - range.from;
    const nextSpan = Math.max(5, Math.min(2000, currentSpan * factor));
    const center = (range.from + range.to) / 2;
    timeScale.setVisibleLogicalRange({
      from: center - nextSpan / 2,
      to: center + nextSpan / 2,
    });
  }, []);

  const fitChart = useCallback(() => chartRef.current?.timeScale().fitContent(), []);
  const scrollToLatest = useCallback(() => chartRef.current?.timeScale().scrollToRealTime(), []);

  useEffect(() => {
    if (!isExpanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsExpanded(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isExpanded]);

  const chartContent = (
    <div
      className={`flex h-full min-w-0 flex-col overflow-hidden border border-line bg-sunken/50 backdrop-blur-sm ${
        isExpanded ? 'fixed inset-0 z-[100] h-[100dvh] w-screen rounded-none bg-neutral-950 pb-[env(safe-area-inset-bottom)]' : 'rounded-2xl'
      }`}
    >
      <div className="shrink-0 border-b border-line bg-panel">
        <div className="flex min-w-0 flex-col gap-1 px-2 py-2 sm:px-4">
        <div className="flex w-full min-w-0 items-center gap-2 overflow-x-auto sm:gap-3">
          <div className="flex items-center gap-2">
            <OkxTokenLogo logo={activeToken.logo} symbol={activeToken.symbol} name={activeToken.name} size="sm" />
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
              <span className="text-xs font-bold text-fg sm:text-sm">
                {activeToken.poolTokenIsBase === false ? `${activeToken.quoteSymbol || 'quote'}/${activeToken.symbol}` : `${activeToken.symbol}/${activeToken.quoteSymbol || 'quote'}`}
              </span>
              <span className="max-w-[10rem] truncate text-[0.75rem] font-mono text-muted sm:max-w-none sm:text-xs">
                TradingView · {isMarketCapChart ? 'Estimated MCAP' : 'USD price'} · {chartSource === 'index' ? 'On-chain swaps live' : chartSource === 'gecko' ? 'GeckoTerminal live' : chartSource === 'binance' ? 'Binance Web3 live' : chartSource === 'cached' ? 'Saved candles · checking live data' : chartSource === 'loading' ? 'Loading candles…' : chartSource === 'rate-limited' ? 'Provider rate limited · showing last candles' : 'Live chart unavailable · retrying'}
              </span>
            </div>
          </div>
          <div className="flex items-center rounded-lg border border-line bg-sunken p-0.5 text-xs">
            {timeframes.map((item) => (
              <button
                key={item}
                onClick={() => setTimeframe(item)}
                className={`rounded px-2.5 py-1.5 text-[0.75rem] sm:px-2 sm:py-1 font-mono transition-colors ${timeframe === item ? 'bg-raised font-bold text-accent' : 'text-muted hover:text-fg'}`}
              >
                {item}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Chart metrics" className="inline-flex items-center rounded-lg border border-line bg-sunken p-0.5 text-xs">
            <button
              onClick={() => setChartMetric('price')}
              aria-pressed={chartMetric === 'price'}
              className={`rounded px-2.5 py-1.5 text-[0.75rem] sm:px-2 sm:py-1 font-semibold transition-colors ${chartMetric === 'price' ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`}
            >
              Price
            </button>
            <button
              onClick={() => setChartMetric('marketCap')}
              aria-pressed={chartMetric === 'marketCap'}
              disabled={!canPlotMarketCap}
              title={canPlotMarketCap ? 'Market cap estimate based on the latest market cap and price snapshot' : 'Market cap requires a recent price and market cap snapshot'}
              className={`rounded px-2.5 py-1.5 text-[0.75rem] sm:px-2 sm:py-1 font-semibold transition-colors ${chartMetric === 'marketCap' && canPlotMarketCap ? 'bg-raised text-fg' : 'text-muted hover:text-fg'} disabled:cursor-not-allowed disabled:opacity-40`}
            >
              MCAP
            </button>
          </div>
          <div role="group" aria-label="Chart style" className="inline-flex items-center rounded-lg border border-line bg-sunken p-0.5 text-xs">
            <button type="button" onClick={() => setChartStyle('candles')} aria-pressed={chartStyle === 'candles'} className={`rounded px-2.5 py-1.5 text-[0.75rem] sm:px-2 sm:py-1 font-semibold ${chartStyle === 'candles' ? 'bg-raised text-accent' : 'text-muted hover:text-fg'}`}>Candles</button>
            <button type="button" onClick={() => setChartStyle('line')} aria-pressed={chartStyle === 'line'} className={`rounded px-2.5 py-1.5 text-[0.75rem] sm:px-2 sm:py-1 font-semibold ${chartStyle === 'line' ? 'bg-raised text-accent' : 'text-muted hover:text-fg'}`}>Line</button>
          </div>
          <button
            type="button"
            onClick={() => setRefreshNonce((nonce) => nonce + 1)}
            disabled={isSoftRefreshing}
            aria-label="Refresh candle chart"
            title="Refresh candle data"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-sunken px-2 py-1.5 text-[0.75rem] font-semibold text-fg-soft transition-colors hover:border-accent/50 hover:text-fg disabled:cursor-wait disabled:opacity-60"
          >
            <BrandLogo brand="bankrdex" size={14} className={isSoftRefreshing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">{isSoftRefreshing ? 'Refreshing…' : 'Refresh'}</span>
          </button>
          <div role="group" aria-label="Chart navigation" className="inline-flex items-center gap-1 rounded-lg border border-line bg-sunken p-0.5">
            <button type="button" onClick={() => adjustZoom(0.8)} aria-label="Zoom in" title="Zoom in" className="rounded p-2 text-fg-soft hover:bg-raised hover:text-fg sm:p-1.5"><ZoomIn className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => adjustZoom(1.25)} aria-label="Zoom out" title="Zoom out" className="rounded p-2 text-fg-soft hover:bg-raised hover:text-fg sm:p-1.5"><ZoomOut className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={fitChart} aria-label="Fit all candles" title="Fit all candles" className="rounded p-2 text-fg-soft hover:bg-raised hover:text-fg sm:p-1.5"><Activity className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={scrollToLatest} aria-label="Go to latest candle" title="Go to latest candle" className="rounded p-2 text-fg-soft hover:bg-raised hover:text-fg sm:p-1.5"><ArrowDownToLine className="h-3.5 w-3.5" /></button>
          </div>
          <button type="button" onClick={() => setIsExpanded((expanded) => !expanded)} aria-label={isExpanded ? 'Exit expanded chart' : 'Expand chart'} title={isExpanded ? 'Exit expanded chart' : 'Expand chart'} className="rounded-lg border border-line bg-sunken p-1.5 text-fg-soft hover:border-accent/50 hover:text-fg">
            {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>

        <div className="flex w-full min-w-0 items-center gap-1.5 overflow-x-auto text-xs">
          <button onClick={() => setShowEma((visible) => !visible)} aria-label="Toggle EMA 20" aria-pressed={showEma} title="EMA 20" className={`rounded-lg border p-1.5 ${showEma ? 'border-warn/50 bg-warn/15 text-warn' : 'border-line text-subtle hover:text-fg-soft'}`}>
            <LineChart className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setShowRsi((visible) => !visible)} aria-label="Toggle RSI 14" aria-pressed={showRsi} title="RSI 14" className={`rounded-lg border px-2 py-1 text-[0.75rem] font-bold ${showRsi ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-300' : 'border-line text-subtle hover:text-fg-soft'}`}>
            RSI
          </button>
          <button onClick={() => setShowVolume((visible) => !visible)} aria-label="Toggle volume" aria-pressed={showVolume} title="Volume" className={`rounded-lg border p-1.5 ${showVolume ? 'border-sky-500/50 bg-sky-500/15 text-sky-300' : 'border-line text-subtle hover:text-fg-soft'}`}>
            <Activity className="h-3.5 w-3.5" />
          </button>
          <button onClick={saveLayout} aria-label={t.saveChartLayout} title={t.saveLayoutForToken} className="rounded-lg border border-line p-1.5 text-muted hover:bg-raised hover:text-fg">
            {layoutSaved ? <Eye className="h-3.5 w-3.5 text-emerald-300" /> : <Save className="h-3.5 w-3.5" />}
          </button>
          <button onClick={() => setShowTradeMarkers((visible) => !visible)} aria-pressed={showTradeMarkers} title={t.tradeMarkers} className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[0.75rem] font-semibold transition-colors ${showTradeMarkers ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300' : 'border-line text-subtle hover:text-fg-soft'}`}>
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
            <span className="hidden sm:inline">{t.tradeMarkers}</span><span className="sm:hidden">B/S</span>
          </button>
          {FEATURES.tradingThesis && (<>
          <button onClick={() => setShowThesisLines((visible) => !visible)} aria-pressed={showThesisLines} title={t.thesisLines} className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[0.75rem] font-semibold transition-colors ${showThesisLines ? 'border-warn/50 bg-warn/15 text-warn' : 'border-line text-subtle hover:text-fg-soft'}`}>
            <Lightbulb className="h-3 w-3" />
            <span className="hidden sm:inline">{t.thesisLines}</span>
          </button>
          <button onClick={() => openComposer()} className="btn-gradient flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-[0.75rem] font-bold text-white">
            <PlusCircle className="h-3 w-3" />
            <span className="hidden sm:inline">{t.createThesis}</span><span className="sm:hidden">Thesis</span>
          </button>
          </>)}
        </div>
      </div>
      </div>

      {isMarketCapChart && (
        <p className="border-b border-line/70 bg-amber-500/5 px-3 py-1.5 text-[0.75rem] leading-relaxed text-amber-200/80">
          {t.historicalMarketCapEstimate}
        </p>
      )}

      {activeCandleDisplay && (
        <div className="flex shrink-0 items-center justify-between gap-x-4 border-b border-line/60 bg-sunken/30 px-2 py-1.5 text-[0.75rem] font-mono text-muted sm:px-4 sm:text-[0.75rem]">
          <div className="flex min-w-0 items-center gap-x-3 overflow-x-auto whitespace-nowrap">
            <span>O: <strong className="text-fg">{formatCurrency(activeCandleDisplay.open, true, isMarketCapChart ? 2 : 7)}</strong></span>
            <span>H: <strong className="text-fg">{formatCurrency(activeCandleDisplay.high, true, isMarketCapChart ? 2 : 7)}</strong></span>
            <span>L: <strong className="text-fg">{formatCurrency(activeCandleDisplay.low, true, isMarketCapChart ? 2 : 7)}</strong></span>
            <span>C: <strong className={activeCandleDisplay.isUp ? 'text-emerald-400' : 'text-rose-400'}>{formatCurrency(activeCandleDisplay.close, true, isMarketCapChart ? 2 : 7)}</strong></span>
            <span>Vol: <strong className="text-fg">${activeCandleDisplay.volume.toLocaleString('en-US')}</strong></span>
          </div>
          {activeThesis && showThesisLines && activeThesis.tokenId === activeToken.id && (
            <span className="text-[0.75rem] text-amber-400">Thesis: &quot;{activeThesis.title}&quot;</span>
          )}
        </div>
      )}

      <div className="relative min-h-[16.25rem] flex-1 sm:min-h-[23.75rem]">
        <div ref={containerRef} className="absolute inset-0" />
        {(chartSource === 'unavailable' || chartSource === 'rate-limited') && candles.length === 0 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/90 p-6 text-center">
            <div>
              <p className="text-sm font-semibold text-fg">{chartSource === 'rate-limited' ? 'Chart provider rate limited' : 'Live OHLCV data unavailable'}</p>
              <p className="mt-1 text-xs text-muted">Verified candle data will retry automatically. No sample candles are shown.</p>
            </div>
          </div>
        )}
      </div>

      <div className="hidden shrink-0 justify-end border-t border-line/70 px-3 py-1 text-[0.75rem] text-subtle sm:flex">
        <a href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noreferrer" className="hover:text-fg-soft">
          Powered by TradingView Lightweight Charts™
        </a>
      </div>
    </div>
  );
  return chartContent;
};