import { StatusBar } from 'expo-status-bar';
import { Audio } from 'expo-av';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { alpha, colors } from './src/theme';
import { clamp, formatNumberBR, stripMarkdown } from './src/format';

const CARD_DURATION = 6500;
const API_BASE =
  typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_API_URL
    ? process.env.EXPO_PUBLIC_API_URL.replace(/\/+$/, '')
    : '';

function apiUrl(path) {
  if (/^https?:\/\//.test(path)) return path;
  if (API_BASE) return `${API_BASE}${path}`;
  return path;
}

function useLayoutMetrics() {
  const { width, height } = useWindowDimensions();
  const usefulWidth = Math.min(width, 520);
  const compact = usefulWidth < 360 || height < 700;
  const spaceScale = clamp(usefulWidth / 390, 0.78, 1.15);
  return { width, height, usefulWidth, compact, spaceScale };
}

function fetchJson(path, options) {
  return fetch(apiUrl(path), {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  }).then(async (response) => {
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.erro || json.detalhe || 'Falha ao consultar a API.');
    return json;
  });
}

function AnimatedNumber({ value, suffix = '', decimals = 0, style }) {
  const animated = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    animated.stopAnimation();
    animated.setValue(0);
    const listener = animated.addListener(({ value: next }) => setDisplay(next));

    // A contagem reforça que cada story está apresentando um dado vivo.
    Animated.timing(animated, {
      toValue: Number(value) || 0,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    return () => {
      animated.removeListener(listener);
      animated.stopAnimation();
    };
  }, [animated, value]);

  return (
    <Text
      allowFontScaling={false}
      adjustsFontSizeToFit
      minimumFontScale={0.62}
      numberOfLines={1}
      style={[styles.animatedNumber, style]}
    >
      {formatNumberBR(display, decimals)}
      {suffix}
    </Text>
  );
}

function ProgressSegments({ cards, current, progress }) {
  const activeWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.progressRow}>
      {cards.map((card, index) => (
        <View key={card.id} style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressFill,
              {
                width: index < current ? '100%' : index === current ? activeWidth : '0%',
              },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

function TopBar({ report }) {
  const pulse = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    // O pulso do chip comunica atualização sem depender de texto explicativo.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0.35, duration: 900, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={styles.topBar}>
      <View style={styles.brandCluster}>
        <View style={styles.brandDot} />
        <View style={styles.brandTextBlock}>
          <Text allowFontScaling={false} numberOfLines={1} style={styles.brandTitle}>
            {report.displayTitle}
          </Text>
          <Text allowFontScaling={false} numberOfLines={1} style={styles.brandSubtitle}>
            {report.subtitle}
          </Text>
        </View>
      </View>
      <View style={styles.liveChip}>
        <Animated.View style={[styles.liveDot, { opacity: pulse }]} />
        <Text allowFontScaling={false} numberOfLines={1} style={styles.liveText}>
          {report.liveLabel}
        </Text>
      </View>
    </View>
  );
}

function StoryCard({ card, compact }) {
  const enter = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0.28)).current;

  useEffect(() => {
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: 550,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [card.id, enter]);

  useEffect(() => {
    // Um brilho ambiente dá identidade ao card sem virar gráfico ou ilustração.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 0.54, duration: 1600, useNativeDriver: false }),
        Animated.timing(glow, { toValue: 0.28, duration: 1600, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [glow]);

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [20, 0] });

  return (
    <View style={[styles.storyCard, compact && styles.storyCardCompact]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ambientGlow,
          Platform.OS === 'web' ? styles.webBlur : null,
          { backgroundColor: card.color, opacity: glow },
        ]}
      />
      <Animated.View style={[styles.cardContent, { opacity: enter, transform: [{ translateY }] }]}>
        <Text allowFontScaling={false} style={[styles.kicker, { color: card.color }]}>
          {card.kicker}
        </Text>
        <Text allowFontScaling={false} style={[styles.cardTitle, compact && styles.cardTitleCompact]}>
          {card.title}
        </Text>
        {card.layout === 'portrait' ? <PortraitLayout card={card} compact={compact} /> : null}
        {card.layout === 'standard' ? <StandardLayout card={card} compact={compact} /> : null}
        {card.layout === 'problem' ? <ProblemLayout card={card} compact={compact} /> : null}
        {card.layout === 'trend' ? <TrendLayout card={card} compact={compact} /> : null}
        {card.layout === 'insights' ? <InsightsLayout card={card} compact={compact} /> : null}
        {card.layout === 'highlights' ? <HighlightsLayout card={card} compact={compact} /> : null}
      </Animated.View>
    </View>
  );
}

function StandardLayout({ card, compact }) {
  const percent = clamp(card.progress?.percent || 0, 0, 100);

  return (
    <View style={styles.bodyBlock}>
      <AnimatedNumber
        value={card.metric.value}
        suffix={card.metric.suffix}
        decimals={card.metric.decimals}
        style={[styles.jumboNumber, compact && styles.jumboNumberCompact, { color: card.color }]}
      />
      <Text allowFontScaling={false} style={styles.metricLabel}>
        {card.metric.label}
      </Text>
      {card.progress ? (
        <View style={styles.standardProgressGroup}>
          <View style={styles.standardProgressTrack}>
            <View style={[styles.standardProgressFill, { width: `${percent}%`, backgroundColor: card.color }]} />
          </View>
          <Text allowFontScaling={false} style={styles.noteText}>
            {card.progress.label}
          </Text>
        </View>
      ) : null}
      {card.note ? (
        <Text allowFontScaling={false} style={styles.noteText}>
          {card.note}
        </Text>
      ) : null}
    </View>
  );
}

function PortraitLayout({ card, compact }) {
  const positive = card.split.positive;
  const negative = card.split.negative;
  const posWidth = clamp(positive.percent, 0, 100);
  const negWidth = clamp(negative.percent, 0, 100);

  return (
    <View style={styles.bodyBlock}>
      <AnimatedNumber
        value={card.total.value}
        style={[styles.totalNumber, compact && styles.totalNumberCompact, { color: colors.text }]}
      />
      <Text allowFontScaling={false} style={styles.metricLabel}>
        {card.total.label}
      </Text>

      <View style={styles.stackedBar}>
        <View style={[styles.stackedPositive, { width: `${posWidth}%` }]} />
        <View style={[styles.stackedNegative, { width: `${negWidth}%` }]} />
      </View>

      <View style={styles.legendGrid}>
        <LegendMetric tone={colors.brand} item={positive} compact={compact} />
        <View style={styles.legendDivider} />
        <LegendMetric tone={colors.danger} item={negative} compact={compact} />
      </View>

      <Text allowFontScaling={false} style={styles.noteText}>
        {card.note}
      </Text>
    </View>
  );
}

function LegendMetric({ item, tone, compact }) {
  return (
    <View style={styles.legendMetric}>
      <View style={styles.legendHeader}>
        <View style={[styles.legendDot, { backgroundColor: tone }]} />
        <Text allowFontScaling={false} style={styles.legendTitle}>
          {item.label} · {formatNumberBR(item.percent, 2)}%
        </Text>
      </View>
      <AnimatedNumber
        value={item.value}
        style={[styles.legendNumber, compact && styles.legendNumberCompact, { color: tone }]}
      />
      <Text allowFontScaling={false} numberOfLines={2} style={styles.legendCaption}>
        {item.legend}
      </Text>
    </View>
  );
}

function ProblemLayout({ card, compact }) {
  const maxValue = Math.max(1, ...(card.segments || []).map((segment) => Number(segment.value) || 0));

  if (card.empty) {
    return (
      <View style={styles.bodyBlock}>
        <View style={styles.emptyPanel}>
          <Text allowFontScaling={false} style={styles.emptyTitle}>
            Métrica em atualização
          </Text>
          <Text allowFontScaling={false} style={styles.noteText}>
            O backend fonte não retornou essa série agora. O app mantém a leitura honesta e não transforma ausência em zero.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.bodyBlock}>
      <View style={styles.problemHeader}>
        <AnimatedNumber
          value={card.metric.value}
          suffix={card.metric.suffix || ''}
          decimals={card.metric.decimals || 0}
          style={[styles.problemNumber, compact && styles.problemNumberCompact, { color: card.color }]}
        />
        <View style={[styles.problemTag, { backgroundColor: alpha(card.color, 0.12), borderColor: alpha(card.color, 0.24) }]}>
          <Text allowFontScaling={false} style={[styles.problemTagText, { color: card.color }]}>
            {card.metric.tag}
          </Text>
        </View>
      </View>
      <Text allowFontScaling={false} style={styles.metricLabel}>
        {card.metric.label}
      </Text>

      <Text allowFontScaling={false} style={[styles.sectionLabel, { color: card.color }]}>
        {card.sectionLabel}
      </Text>
      <View style={styles.segmentList}>
        {(card.segments || []).map((segment) => (
          <View key={segment.label} style={styles.segmentRow}>
            <View style={styles.segmentHeader}>
              <Text allowFontScaling={false} style={styles.segmentLabel}>
                {segment.label}
              </Text>
              <Text allowFontScaling={false} style={styles.segmentValue}>
                {segment.display}
              </Text>
            </View>
            <View style={styles.segmentTrack}>
              <View
                style={[
                  styles.segmentFill,
                  {
                    width: `${clamp((Number(segment.value) / maxValue) * 100, 2, 100)}%`,
                    backgroundColor: card.color,
                  },
                ]}
              />
            </View>
          </View>
        ))}
      </View>

      <View style={[styles.gapStrip, { borderColor: alpha(card.color, 0.32), backgroundColor: alpha(card.color, 0.1) }]}>
        <Text allowFontScaling={false} style={[styles.gapLabel, { color: card.color }]}>
          {card.gap.label}
        </Text>
        <Text allowFontScaling={false} style={styles.gapValue}>
          {card.gap.value}
        </Text>
        <Text allowFontScaling={false} style={styles.gapObservation}>
          {card.gap.observation}
        </Text>
      </View>
    </View>
  );
}

function TrendLayout({ card, compact }) {
  const max = Math.max(1, ...(card.bars || []).map((bar) => Number(bar.value) || 0));

  return (
    <View style={styles.bodyBlock}>
      <View style={styles.trendHeadline}>
        <AnimatedNumber
          value={card.metric.value}
          suffix={card.metric.suffix}
          decimals={card.metric.decimals}
          style={[styles.trendNumber, compact && styles.trendNumberCompact, { color: card.color }]}
        />
        <View style={styles.deltaChip}>
          <Text allowFontScaling={false} style={styles.deltaValue}>
            {card.delta.value >= 0 ? '+' : ''}
            {formatNumberBR(card.delta.value, 2)}pp
          </Text>
          <Text allowFontScaling={false} style={styles.deltaLabel}>
            {card.delta.label}
          </Text>
        </View>
      </View>
      <Text allowFontScaling={false} style={styles.metricLabel}>
        {card.metric.label}
      </Text>

      <Text allowFontScaling={false} style={[styles.sectionLabel, { color: card.color }]}>
        Trajetória em {card.bars.length} pontos
      </Text>
      <View style={styles.miniBars}>
        {card.bars.map((bar) => {
          const color = bar.tone === 'accent' ? colors.accent : bar.tone === 'dim' ? colors.textDim : card.color;
          return (
            <View key={bar.label} style={styles.miniBarItem}>
              <View style={styles.miniBarFrame}>
                <View
                  style={[
                    styles.miniBarFill,
                    {
                      height: `${clamp((Number(bar.value) / max) * 100, 6, 100)}%`,
                      backgroundColor: color,
                    },
                  ]}
                />
              </View>
              <Text allowFontScaling={false} numberOfLines={2} style={styles.miniBarLabel}>
                {bar.label}
              </Text>
              <Text allowFontScaling={false} style={styles.miniBarValue}>
                {formatNumberBR(bar.value, 1)}%
              </Text>
            </View>
          );
        })}
      </View>

      <View style={styles.averageChip}>
        <Text allowFontScaling={false} style={styles.averageLabel}>
          {card.average.label}
        </Text>
        <Text allowFontScaling={false} style={styles.averageValue}>
          {card.average.value}
        </Text>
      </View>
      <Text allowFontScaling={false} style={styles.noteText}>
        {card.observation}
      </Text>
    </View>
  );
}

function insightToneColor(tone, fallback) {
  return {
    brand: colors.brand,
    danger: colors.danger,
    warn: colors.warn,
    info: colors.info,
    accent: colors.accent,
  }[tone] || fallback;
}

function InsightsLayout({ card, compact }) {
  const items = card.insights || [];
  // O slide final comprime a leitura enviada sem virar tabela ou dashboard.
  return (
    <View style={styles.insightsBody}>
      <View style={[styles.insightLead, { borderColor: alpha(card.color, 0.3), backgroundColor: alpha(card.color, 0.07) }]}>
        <Text allowFontScaling={false} style={[styles.insightIcon, { color: card.color }]}>
          {card.lead?.icon}
        </Text>
        <Text allowFontScaling={false} style={styles.insightLeadTitle}>
          {card.lead?.title}
        </Text>
        <Text allowFontScaling={false} style={[styles.insightBodyText, compact && styles.insightBodyTextCompact]}>
          {card.lead?.body}
        </Text>
      </View>

      <View style={styles.insightStack}>
        {items.map((item) => {
          const tone = insightToneColor(item.tone, card.color);
          return <InsightTile key={item.title} item={item} tone={tone} compact={compact} wide />;
        })}
      </View>
    </View>
  );
}

function InsightTile({ item, tone, compact, wide = false }) {
  return (
    <View
      style={[
        wide ? styles.insightTileWide : styles.insightTile,
        {
          borderColor: alpha(tone, 0.28),
          backgroundColor: alpha(tone, 0.08),
        },
      ]}
    >
      <Text allowFontScaling={false} style={[styles.insightIconSmall, { color: tone }]}>
        {item.icon}
      </Text>
      <Text allowFontScaling={false} style={styles.insightTileTitle}>
        {item.title}
      </Text>
      <Text allowFontScaling={false} style={[styles.insightBodyText, compact && styles.insightBodyTextCompact]}>
        {item.body}
      </Text>
    </View>
  );
}

function HighlightsLayout({ card, compact }) {
  return (
    <View style={styles.highlightsBody}>
      {(card.highlights || []).slice(0, 2).map((item, index) => {
        const tone = insightToneColor(item.tone, card.color);
        return (
          <View
            key={item.title}
            style={[
              styles.highlightCard,
              compact && styles.highlightCardCompact,
              {
                borderColor: alpha(tone, 0.34),
                backgroundColor: alpha(tone, index === 0 ? 0.11 : 0.09),
              },
            ]}
          >
            <View style={styles.highlightTopline}>
              <Text allowFontScaling={false} style={[styles.highlightIndex, { color: tone }]}>
                0{index + 1}
              </Text>
              <View style={[styles.highlightPill, { backgroundColor: alpha(tone, 0.14), borderColor: alpha(tone, 0.32) }]}>
                <Text allowFontScaling={false} style={[styles.highlightPillText, { color: tone }]}>
                  {item.label}
                </Text>
              </View>
            </View>
            <Text allowFontScaling={false} style={[styles.highlightTitle, compact && styles.highlightTitleCompact]}>
              {item.title}
            </Text>
            <Text allowFontScaling={false} style={[styles.highlightBody, compact && styles.highlightBodyCompact]}>
              {item.body}
            </Text>
            <View style={[styles.highlightAction, { borderColor: alpha(tone, 0.26) }]}>
              <Text allowFontScaling={false} style={[styles.highlightActionLabel, { color: tone }]}>
                Próximo movimento
              </Text>
              <Text allowFontScaling={false} style={styles.highlightActionText}>
                {item.action}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function BottomBar({ onBriefing, onAsk }) {
  return (
    <View style={styles.bottomBar}>
      <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]} onPress={onBriefing}>
        <Text allowFontScaling={false} style={styles.primaryIcon}>
          ▶
        </Text>
        <Text allowFontScaling={false} numberOfLines={1} style={styles.primaryButtonText}>
          Briefing IA · 60s
        </Text>
      </Pressable>
      <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} onPress={onAsk}>
        <Text allowFontScaling={false} style={styles.secondaryButtonText}>
          Perguntar
        </Text>
      </Pressable>
    </View>
  );
}

function StoryControls({ current, total, paused, onPrev, onNext, onLongPress, onPressOut }) {
  const atStart = current === 0;
  const atEnd = current === total - 1;
  const prevMuted = paused || atStart;
  const nextMuted = paused || atEnd;

  return (
    <View pointerEvents="box-none" style={styles.sideControls}>
      <Pressable
        accessibilityLabel="Voltar story"
        accessibilityRole="button"
        delayLongPress={220}
        disabled={atStart}
        hitSlop={12}
        onLongPress={onLongPress}
        onPress={onPrev}
        onPressOut={onPressOut}
        style={({ pressed }) => [
          styles.storyNavButton,
          prevMuted && styles.storyNavButtonDisabled,
          pressed && !prevMuted && styles.pressed,
        ]}
      >
        <Text allowFontScaling={false} style={[styles.storyNavIcon, prevMuted && styles.storyNavIconDisabled]}>
          {'<'}
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Avancar story"
        accessibilityRole="button"
        delayLongPress={220}
        disabled={atEnd}
        hitSlop={12}
        onLongPress={onLongPress}
        onPress={onNext}
        onPressOut={onPressOut}
        style={({ pressed }) => [
          styles.storyNavButton,
          nextMuted && styles.storyNavButtonDisabled,
          pressed && !nextMuted && styles.pressed,
        ]}
      >
        <Text allowFontScaling={false} style={[styles.storyNavIcon, nextMuted && styles.storyNavIconDisabled]}>
          {'>'}
        </Text>
      </Pressable>
    </View>
  );
}

function StoriesScreen({ metrics }) {
  const { compact, spaceScale } = useLayoutMetrics();
  const [current, setCurrent] = useState(0);
  const [heldPaused, setHeldPaused] = useState(false);
  const [briefingVisible, setBriefingVisible] = useState(false);
  const [askVisible, setAskVisible] = useState(false);
  const longPressRef = useRef(false);
  const progressValue = useRef(0);
  const progress = useRef(new Animated.Value(0)).current;
  const cards = metrics.cards;
  const modalOpen = briefingVisible || askVisible;
  const paused = heldPaused || modalOpen;

  useEffect(() => {
    const id = progress.addListener(({ value }) => {
      progressValue.current = value;
    });
    return () => progress.removeListener(id);
  }, [progress]);

  const goNext = useCallback(() => {
    setCurrent((index) => Math.min(cards.length - 1, index + 1));
  }, [cards.length]);

  const goPrev = useCallback(() => {
    setCurrent((index) => Math.max(0, index - 1));
  }, []);

  const animateFrom = useCallback(
    (from) => {
      progress.stopAnimation();
      progress.setValue(from);
      Animated.timing(progress, {
        toValue: 1,
        duration: Math.max(220, (1 - from) * CARD_DURATION),
        easing: Easing.linear,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (!finished) return;
        if (current < cards.length - 1) goNext();
      });
    },
    [cards.length, current, goNext, progress],
  );

  useEffect(() => {
    if (!paused) animateFrom(0);
    return () => progress.stopAnimation();
  }, [animateFrom, current, paused, progress]);

  useEffect(() => {
    if (paused) {
      progress.stopAnimation();
      return;
    }
    animateFrom(progressValue.current);
  }, [animateFrom, paused, progress]);

  const handlePress = useCallback(
    (direction) => {
      if (longPressRef.current) return;
      if (direction === 'prev') goPrev();
      if (direction === 'next') goNext();
    },
    [goNext, goPrev],
  );

  const handleLongPress = useCallback(() => {
    longPressRef.current = true;
    setHeldPaused(true);
  }, []);

  const handlePressOut = useCallback(() => {
    if (!longPressRef.current) return;
    setHeldPaused(false);
    setTimeout(() => {
      longPressRef.current = false;
    }, 0);
  }, []);

  return (
    <SafeAreaView style={[styles.safeArea, Platform.OS === 'web' && styles.webNoSelect]}>
      <View style={[styles.shell, { paddingHorizontal: Math.round(14 * spaceScale) }]}>
        <ProgressSegments cards={cards} current={current} progress={progress} />
        <TopBar report={metrics.report} />

        <View style={styles.cardFrame}>
          <StoryCard card={cards[current]} compact={compact} />
          <View pointerEvents="box-none" style={styles.touchLayer}>
            <Pressable
              delayLongPress={220}
              onLongPress={handleLongPress}
              onPress={() => handlePress('prev')}
              onPressOut={handlePressOut}
              style={styles.touchLeft}
            />
            <Pressable
              delayLongPress={220}
              onLongPress={handleLongPress}
              onPress={() => handlePress('next')}
              onPressOut={handlePressOut}
              style={styles.touchRight}
            />
          </View>
          <StoryControls
            current={current}
            total={cards.length}
            paused={heldPaused}
            onPrev={() => handlePress('prev')}
            onNext={() => handlePress('next')}
            onLongPress={handleLongPress}
            onPressOut={handlePressOut}
          />
          {heldPaused ? (
            <View style={styles.pausedTag}>
              <Text allowFontScaling={false} style={styles.pausedText}>
                pausado
              </Text>
            </View>
          ) : null}
        </View>

        {false && current === cards.length - 1 ? (
          <Text allowFontScaling={false} style={styles.lastHint}>
            Toque à esquerda para voltar · à direita para avançar · segure para pausar
          </Text>
        ) : null}
        <BottomBar onBriefing={() => setBriefingVisible(true)} onAsk={() => setAskVisible(true)} />
      </View>

      <BriefingModal visible={briefingVisible} onClose={() => setBriefingVisible(false)} />
      <AskModal visible={askVisible} metrics={metrics} onClose={() => setAskVisible(false)} />
    </SafeAreaView>
  );
}

function BriefingModal({ visible, onClose }) {
  const [voice, setVoice] = useState('ponderada');
  const [loading, setLoading] = useState(false);
  const [script, setScript] = useState('');
  const [engine, setEngine] = useState('');
  const [audioUrl, setAudioUrl] = useState(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const soundRef = useRef(null);

  const unloadSound = useCallback(async () => {
    if (soundRef.current) {
      await soundRef.current.unloadAsync().catch(() => null);
      soundRef.current = null;
    }
    setPlaying(false);
  }, []);

  const generate = useCallback(async () => {
    if (!visible) return;
    setLoading(true);
    setError('');
    setScript('');
    setAudioUrl(null);
    await unloadSound();

    try {
      const result = await fetchJson('/api/briefing', {
        method: 'POST',
        body: JSON.stringify({ voice }),
      });
      setScript(stripMarkdown(result.script || ''));
      setEngine(result.engine || 'motor em atualização');
      setAudioUrl(result.audioUrl ? apiUrl(result.audioUrl) : null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [unloadSound, visible, voice]);

  useEffect(() => {
    if (visible) generate();
    return () => {
      unloadSound();
    };
  }, [generate, unloadSound, visible]);

  const toggleAudio = async () => {
    if (!audioUrl || loading) return;

    try {
      if (soundRef.current && playing) {
        await soundRef.current.pauseAsync();
        setPlaying(false);
        return;
      }

      if (!soundRef.current) {
        const { sound } = await Audio.Sound.createAsync({ uri: audioUrl }, { shouldPlay: false });
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status) => {
          if (status?.didJustFinish) setPlaying(false);
        });
      }

      await soundRef.current.playAsync();
      setPlaying(true);
    } catch (err) {
      setError('Áudio indisponível agora. A transcrição continua disponível.');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalPanel}>
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleBlock}>
              <Text allowFontScaling={false} style={styles.modalKicker}>
                BRIEFING EXECUTIVO · IA
              </Text>
              <Text allowFontScaling={false} style={styles.modalTitle}>
                60 segundos, direto ao ponto
              </Text>
            </View>
            <Pressable style={styles.closeButton} onPress={onClose}>
              <Text allowFontScaling={false} style={styles.closeText}>
                ×
              </Text>
            </Pressable>
          </View>

          <View style={styles.voiceRow}>
            {[
              ['grave', 'Grave'],
              ['ponderada', 'Ponderada'],
              ['energica', 'Enérgica'],
            ].map(([key, label]) => (
              <Pressable
                key={key}
                style={[styles.voiceChip, voice === key && styles.voiceChipActive]}
                onPress={() => setVoice(key)}
              >
                <Text allowFontScaling={false} style={[styles.voiceText, voice === key && styles.voiceTextActive]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.playerRow}>
            <Pressable style={[styles.playerButton, !audioUrl && !loading && styles.playerButtonDisabled]} onPress={toggleAudio}>
              {loading ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text allowFontScaling={false} style={styles.playerIcon}>
                  {playing ? 'Ⅱ' : '▶'}
                </Text>
              )}
            </Pressable>
            <View style={styles.playerCopy}>
              <Text allowFontScaling={false} style={styles.playerStatus}>
                {loading ? 'Gerando com IA...' : audioUrl ? (playing ? 'Reproduzindo' : 'Toque para ouvir') : 'Áudio indisponível'}
              </Text>
              <Text allowFontScaling={false} style={styles.playerEngine}>
                {engine || 'aguardando motor'}
              </Text>
            </View>
          </View>

          <ScrollView style={styles.transcriptBox} contentContainerStyle={styles.transcriptContent}>
            {loading ? <SkeletonText /> : null}
            {error ? (
              <View style={styles.errorBox}>
                <Text allowFontScaling={false} style={styles.errorText}>
                  {error}
                </Text>
                <Pressable style={styles.retryButton} onPress={generate}>
                  <Text allowFontScaling={false} style={styles.retryText}>
                    Tentar de novo
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {!loading && !error ? (
              <Text allowFontScaling={false} style={styles.transcriptText}>
                {script}
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function SkeletonText() {
  return (
    <View style={styles.skeletonGroup}>
      {[90, 80, 95, 70, 85].map((width, index) => (
        <View key={index} style={[styles.skeletonLine, { width: `${width}%` }]} />
      ))}
    </View>
  );
}

function AskModal({ visible, metrics, onClose }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [engine, setEngine] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const ask = async (nextQuestion = question) => {
    const cleaned = String(nextQuestion || '').trim();
    if (cleaned.length < 3 || loading) return;
    setQuestion(cleaned);
    setLoading(true);
    setError('');
    setAnswer('');

    try {
      const result = await fetchJson('/api/ask', {
        method: 'POST',
        body: JSON.stringify({ question: cleaned }),
      });
      setAnswer(stripMarkdown(result.answer || ''));
      setEngine(result.engine || 'motor em atualização');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!visible) {
      setQuestion('');
      setAnswer('');
      setEngine('');
      setError('');
      setLoading(false);
    }
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalPanel}>
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleBlock}>
              <Text allowFontScaling={false} style={styles.modalKicker}>
                PERGUNTE À BASE · IA
              </Text>
              <Text allowFontScaling={false} style={styles.modalTitle}>
                Dúvida em uma frase?
              </Text>
            </View>
            <Pressable style={styles.closeButton} onPress={onClose}>
              <Text allowFontScaling={false} style={styles.closeText}>
                ×
              </Text>
            </Pressable>
          </View>

          <TextInput
            multiline
            onChangeText={setQuestion}
            placeholder="Ex.: Por que Filiados bloqueiam mais push que Outros?"
            placeholderTextColor={colors.textDim}
            style={styles.askInput}
            value={question}
          />

          <View style={styles.suggestionList}>
            {metrics.questions.map((item) => (
              <Pressable key={item} style={styles.suggestionChip} onPress={() => ask(item)}>
                <Text allowFontScaling={false} style={styles.suggestionText}>
                  {item}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            disabled={question.trim().length < 3 || loading}
            style={[styles.askButton, (question.trim().length < 3 || loading) && styles.askButtonDisabled]}
            onPress={() => ask()}
          >
            {loading ? <ActivityIndicator color={colors.bg} /> : null}
            <Text allowFontScaling={false} style={styles.askButtonText}>
              Consultar IA
            </Text>
          </Pressable>

          <View style={styles.answerBox}>
            <Text allowFontScaling={false} style={styles.answerKicker}>
              RESPOSTA
            </Text>
            {error ? (
              <Text allowFontScaling={false} style={styles.errorText}>
                {error}
              </Text>
            ) : (
              <Text allowFontScaling={false} style={styles.answerText}>
                {answer || 'A resposta aparecerá aqui.'}
              </Text>
            )}
            {engine ? (
              <Text allowFontScaling={false} style={styles.playerEngine}>
                {engine}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function LoadingState() {
  return (
    <SafeAreaView style={styles.centerState}>
      <ActivityIndicator color={colors.accent} size="large" />
      <Text allowFontScaling={false} style={styles.centerTitle}>
        Carregando painel...
      </Text>
      <Text allowFontScaling={false} style={styles.centerSubtitle}>
        Buscando dados reais do CRM.
      </Text>
    </SafeAreaView>
  );
}

function ErrorState({ error, fallbackUrl, onRetry }) {
  return (
    <SafeAreaView style={styles.centerState}>
      <Text allowFontScaling={false} style={styles.centerTitle}>
        Não foi possível carregar
      </Text>
      <Text allowFontScaling={false} style={styles.centerSubtitle}>
        {error}
      </Text>
      <Pressable style={styles.primaryButtonWide} onPress={onRetry}>
        <Text allowFontScaling={false} style={styles.primaryButtonText}>
          Tentar novamente
        </Text>
      </Pressable>
      <Pressable style={styles.fallbackButton} onPress={() => Linking.openURL(fallbackUrl)}>
        <Text allowFontScaling={false} style={styles.fallbackText}>
          Abrir painel original
        </Text>
      </Pressable>
    </SafeAreaView>
  );
}

function AppShell() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setMetrics(await fetchJson('/api/metrics'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingState />;
  if (error || !metrics) {
    return (
      <ErrorState
        error={error || 'Resposta vazia da API.'}
        fallbackUrl={metrics?.report?.fallbackUrl || 'https://report-saturacao-crm.onrender.com/'}
        onRetry={load}
      />
    );
  }
  return <StoriesScreen metrics={metrics} />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AppShell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
  },
  webNoSelect: {
    userSelect: 'none',
    WebkitUserSelect: 'none',
    MozUserSelect: 'none',
    msUserSelect: 'none',
    WebkitTouchCallout: 'none',
    touchAction: 'manipulation',
  },
  shell: {
    flex: 1,
    width: '100%',
    maxWidth: 520,
    paddingTop: 8,
    paddingBottom: 12,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 5,
    height: 4,
    marginBottom: 12,
  },
  progressTrack: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  topBar: {
    minHeight: 42,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  brandCluster: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandDot: {
    width: 13,
    height: 13,
    borderRadius: 13,
    backgroundColor: colors.accent,
  },
  brandTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  brandTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  brandSubtitle: {
    marginTop: 2,
    color: colors.textDim,
    fontSize: 10,
    fontWeight: '700',
  },
  liveChip: {
    maxWidth: 150,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 7,
    backgroundColor: colors.accent,
  },
  liveText: {
    flexShrink: 1,
    color: colors.text,
    fontSize: 9,
    fontWeight: '800',
  },
  cardFrame: {
    flex: 1,
    position: 'relative',
    minHeight: 0,
  },
  storyCard: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    borderRadius: 26,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElev,
    padding: 22,
    paddingBottom: 68,
  },
  storyCardCompact: {
    padding: 16,
    paddingBottom: 60,
    borderRadius: 22,
  },
  ambientGlow: {
    position: 'absolute',
    top: -170,
    right: -170,
    width: 340,
    height: 340,
    borderRadius: 340,
  },
  webBlur: {
    filter: 'blur(70px)',
  },
  cardContent: {
    flex: 1,
    minHeight: 0,
  },
  kicker: {
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0,
    marginBottom: 8,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '900',
    marginBottom: 14,
  },
  cardTitleCompact: {
    fontSize: 21,
    lineHeight: 25,
    marginBottom: 10,
  },
  bodyBlock: {
    flex: 1,
    minHeight: 0,
    justifyContent: 'space-between',
    gap: 12,
  },
  animatedNumber: {
    color: colors.text,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0,
  },
  jumboNumber: {
    fontSize: 58,
    lineHeight: 64,
  },
  jumboNumberCompact: {
    fontSize: 46,
    lineHeight: 52,
  },
  totalNumber: {
    fontSize: 50,
    lineHeight: 56,
  },
  totalNumberCompact: {
    fontSize: 40,
    lineHeight: 46,
  },
  problemNumber: {
    fontSize: 46,
    lineHeight: 52,
  },
  problemNumberCompact: {
    fontSize: 36,
    lineHeight: 42,
  },
  trendNumber: {
    flex: 1,
    fontSize: 50,
    lineHeight: 56,
  },
  trendNumberCompact: {
    fontSize: 40,
    lineHeight: 46,
  },
  metricLabel: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  standardProgressGroup: {
    gap: 8,
  },
  standardProgressTrack: {
    height: 9,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  standardProgressFill: {
    height: '100%',
    borderRadius: 999,
  },
  noteText: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  stackedBar: {
    height: 18,
    overflow: 'hidden',
    flexDirection: 'row',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  stackedPositive: {
    height: '100%',
    backgroundColor: colors.brand,
  },
  stackedNegative: {
    height: '100%',
    backgroundColor: colors.danger,
  },
  legendGrid: {
    minHeight: 98,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
  },
  legendMetric: {
    flex: 1,
    minWidth: 0,
  },
  legendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 8,
  },
  legendTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  legendNumber: {
    marginTop: 8,
    fontSize: 25,
    lineHeight: 30,
  },
  legendNumberCompact: {
    fontSize: 21,
    lineHeight: 26,
  },
  legendCaption: {
    color: colors.textDim,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },
  legendDivider: {
    width: 1,
    marginHorizontal: 12,
    backgroundColor: colors.border,
  },
  problemHeader: {
    alignItems: 'flex-start',
    gap: 8,
  },
  problemTag: {
    maxWidth: '100%',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  problemTagText: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0,
    marginTop: 2,
  },
  segmentList: {
    gap: 9,
  },
  segmentRow: {
    gap: 5,
  },
  segmentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  segmentLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  segmentValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  segmentTrack: {
    height: 8,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  segmentFill: {
    height: '100%',
    borderRadius: 999,
  },
  gapStrip: {
    borderLeftWidth: 3,
    borderRadius: 8,
    padding: 12,
  },
  gapLabel: {
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  gapValue: {
    marginTop: 2,
    color: colors.text,
    fontSize: 25,
    lineHeight: 31,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  gapObservation: {
    marginTop: 4,
    color: colors.textDim,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  emptyPanel: {
    borderLeftWidth: 3,
    borderLeftColor: colors.warn,
    padding: 14,
    borderRadius: 8,
    backgroundColor: alpha(colors.warn, 0.1),
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 6,
  },
  trendHeadline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  deltaChip: {
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: alpha(colors.accent, 0.1),
    borderWidth: 1,
    borderColor: alpha(colors.accent, 0.2),
  },
  deltaValue: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  deltaLabel: {
    marginTop: 2,
    color: colors.textDim,
    fontSize: 9,
    fontWeight: '800',
  },
  miniBars: {
    height: 142,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  miniBarItem: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
  },
  miniBarFrame: {
    width: '100%',
    height: 86,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  miniBarFill: {
    width: '100%',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  miniBarLabel: {
    minHeight: 27,
    color: colors.textDim,
    textAlign: 'center',
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '800',
  },
  miniBarValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  averageChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  averageLabel: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  averageValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
  },
  insightsBody: {
    flex: 1,
    minHeight: 0,
    justifyContent: 'space-between',
    gap: 6,
  },
  insightLead: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 9,
  },
  insightIcon: {
    fontSize: 14,
    lineHeight: 15,
    fontWeight: '900',
    marginBottom: 4,
  },
  insightLeadTitle: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '900',
    marginBottom: 4,
  },
  insightBodyText: {
    color: colors.textDim,
    fontSize: 8.4,
    lineHeight: 10.4,
    fontWeight: '700',
  },
  insightBodyTextCompact: {
    fontSize: 7.9,
    lineHeight: 9.8,
  },
  insightStack: {
    gap: 6,
  },
  insightGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  insightTile: {
    width: '48.7%',
    minHeight: 94,
    borderWidth: 1,
    borderRadius: 8,
    padding: 9,
  },
  insightTileWide: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 8,
    padding: 7,
  },
  insightIconSmall: {
    fontSize: 11,
    lineHeight: 12,
    fontWeight: '900',
    marginBottom: 3,
  },
  insightTileTitle: {
    color: colors.text,
    fontSize: 9.4,
    lineHeight: 11.2,
    fontWeight: '900',
    marginBottom: 3,
  },
  highlightsBody: {
    flex: 1,
    minHeight: 0,
    justifyContent: 'space-between',
    gap: 12,
  },
  highlightCard: {
    flex: 1,
    minHeight: 0,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  highlightCardCompact: {
    padding: 11,
  },
  highlightTopline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 9,
  },
  highlightIndex: {
    fontSize: 26,
    lineHeight: 29,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  highlightPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  highlightPillText: {
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  highlightTitle: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '900',
    marginBottom: 8,
  },
  highlightTitleCompact: {
    fontSize: 17,
    lineHeight: 21,
    marginBottom: 6,
  },
  highlightBody: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  highlightBodyCompact: {
    fontSize: 10.7,
    lineHeight: 15,
  },
  highlightAction: {
    marginTop: 'auto',
    borderTopWidth: 1,
    paddingTop: 9,
  },
  highlightActionLabel: {
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  highlightActionText: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
  },
  touchLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
  },
  touchLeft: {
    width: '34%',
  },
  touchRight: {
    flex: 1,
  },
  sideControls: {
    position: 'absolute',
    left: -8,
    right: -8,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  storyNavButton: {
    width: 42,
    height: 42,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: alpha(colors.text, 0.22),
    backgroundColor: alpha(colors.bg, 0.7),
  },
  storyNavButtonDisabled: {
    opacity: 0.28,
  },
  storyNavIcon: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 26,
    fontWeight: '900',
  },
  storyNavIconDisabled: {
    color: colors.textDim,
  },
  pausedTag: {
    position: 'absolute',
    top: 14,
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: alpha(colors.bg, 0.72),
    borderWidth: 1,
    borderColor: colors.border,
  },
  pausedText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '900',
  },
  lastHint: {
    color: colors.textDim,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '800',
    paddingTop: 8,
  },
  bottomBar: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 12,
  },
  primaryButton: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 999,
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
  },
  primaryIcon: {
    color: colors.bg,
    fontSize: 14,
    fontWeight: '900',
  },
  primaryButtonText: {
    color: colors.bg,
    fontSize: 14,
    fontWeight: '900',
  },
  secondaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  pressed: {
    opacity: 0.82,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.68)',
  },
  modalPanel: {
    maxHeight: '90%',
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElev,
    padding: 18,
    gap: 14,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  modalTitleBlock: {
    flex: 1,
  },
  modalKicker: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  modalTitle: {
    marginTop: 4,
    color: colors.text,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '900',
  },
  closeButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  closeText: {
    color: colors.text,
    fontSize: 25,
    lineHeight: 28,
    fontWeight: '800',
  },
  voiceRow: {
    flexDirection: 'row',
    gap: 8,
  },
  voiceChip: {
    flex: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  voiceChipActive: {
    borderColor: colors.accent,
    backgroundColor: alpha(colors.accent, 0.12),
  },
  voiceText: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '900',
  },
  voiceTextActive: {
    color: colors.accent,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  playerButton: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 58,
    backgroundColor: colors.accent,
  },
  playerButtonDisabled: {
    backgroundColor: colors.textDim,
  },
  playerIcon: {
    color: colors.bg,
    fontSize: 22,
    fontWeight: '900',
  },
  playerCopy: {
    flex: 1,
  },
  playerStatus: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  playerEngine: {
    marginTop: 4,
    color: colors.textDim,
    fontSize: 10,
    fontWeight: '700',
  },
  transcriptBox: {
    minHeight: 180,
    maxHeight: 260,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  transcriptContent: {
    padding: 14,
  },
  transcriptText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '700',
  },
  skeletonGroup: {
    gap: 10,
  },
  skeletonLine: {
    height: 13,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  errorBox: {
    gap: 10,
  },
  errorText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '800',
  },
  retryButton: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  retryText: {
    color: colors.bg,
    fontSize: 12,
    fontWeight: '900',
  },
  askInput: {
    minHeight: 94,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 12,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    textAlignVertical: 'top',
  },
  suggestionList: {
    gap: 8,
  },
  suggestionChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  suggestionText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  askButton: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  askButtonDisabled: {
    opacity: 0.45,
  },
  askButtonText: {
    color: colors.bg,
    fontSize: 13,
    fontWeight: '900',
  },
  answerBox: {
    minHeight: 130,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 14,
  },
  answerKicker: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '900',
    marginBottom: 8,
  },
  answerText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '700',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
    backgroundColor: colors.bg,
  },
  centerTitle: {
    color: colors.text,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '900',
  },
  centerSubtitle: {
    maxWidth: 420,
    color: colors.textDim,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  primaryButtonWide: {
    minHeight: 46,
    minWidth: 210,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.accent,
    paddingHorizontal: 18,
  },
  fallbackButton: {
    minHeight: 42,
    minWidth: 210,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 18,
  },
  fallbackText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
});
