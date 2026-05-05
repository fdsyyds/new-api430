import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  TextArea,
  Select,
  Card,
  Modal,
  Typography,
  Spin,
  Toast,
} from '@douyinfe/semi-ui';
import { Download, History, ImageIcon, Trash2, WandSparkles, X } from 'lucide-react';
import { API } from '../../helpers/api';

const { Title, Text } = Typography;

const SIZE_OPTIONS = [
  { label: '1024x1024（1K 方图）', value: '1024x1024' },
  { label: '1536x1024（1.5K 横图）', value: '1536x1024' },
  { label: '1024x1536（1.5K 竖图）', value: '1024x1536' },
  { label: '2048x2048（2K 方图）', value: '2048x2048' },
  { label: '2880x2880（3K 方图）', value: '2880x2880' },
  { label: '3840x2160（4K 横图）', value: '3840x2160' },
  { label: '2160x3840（4K 竖图）', value: '2160x3840' },
];

const QUALITY_OPTIONS = ['high', 'medium', 'low', 'auto'];
const DRAW_HISTORY_LIMIT = 10;
const DRAW_GENERATION_COUNT = 1;
const MAX_CONCURRENT_GENERATIONS = 3;
const DRAW_HISTORY_DB = 'new-api-classic-draw-history';
const DRAW_HISTORY_STORE = 'records';
const DRAW_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';
const DRAW_SETTINGS_STORAGE_PREFIX = 'new-api-classic-draw-settings';
const DEFAULT_DRAW_GROUP = 'GPT';
const DEFAULT_DRAW_MODEL = 'gpt-image-2';
const DEFAULT_POLISH_GROUP = 'GPT';
const DEFAULT_POLISH_MODEL = 'gpt-5.5';

function toModelOptions(models) {
  return (Array.isArray(models) ? models : []).map((item) => ({
    label: item,
    value: item,
  }));
}

function getCurrentUserId() {
  return localStorage.getItem('uid') || 'anonymous';
}

function getDrawSettingsKey(userId) {
  return `${DRAW_SETTINGS_STORAGE_PREFIX}:${userId || 'anonymous'}`;
}

function readDrawSettings(userId) {
  try {
    const raw = localStorage.getItem(getDrawSettingsKey(userId));
    if (!raw) return {};

    const settings = JSON.parse(raw);
    return settings && typeof settings === 'object' ? settings : {};
  } catch {
    return {};
  }
}

function saveDrawSettings(userId, settings) {
  try {
    localStorage.setItem(getDrawSettingsKey(userId), JSON.stringify(settings));
  } catch {
    // Ignore storage failures so drawing still works in restricted browsers.
  }
}

function getSavedString(settings, key, fallback = '') {
  const value = settings?.[key];
  return typeof value === 'string' && value ? value : fallback;
}

function getSavedMode(settings) {
  return settings?.mode === 'edit' ? 'edit' : 'generate';
}

function getSavedSize(settings) {
  const savedSize = getSavedString(settings, 'size', '1024x1024');
  return SIZE_OPTIONS.some((item) => item.value === savedSize)
    ? savedSize
    : '1024x1024';
}

function getSavedQuality(settings) {
  const savedQuality = getSavedString(settings, 'quality', 'auto');
  return QUALITY_OPTIONS.includes(savedQuality) ? savedQuality : 'auto';
}

function openHistoryDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const request = window.indexedDB.open(DRAW_HISTORY_DB, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DRAW_HISTORY_STORE)) {
        const store = db.createObjectStore(DRAW_HISTORY_STORE, {
          keyPath: 'id',
        });
        store.createIndex('createdAt', 'createdAt');
      }
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function withHistoryStore(mode, handler) {
  const db = await openHistoryDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAW_HISTORY_STORE, mode);
    const store = tx.objectStore(DRAW_HISTORY_STORE);
    const request = handler(store);

    if (request) {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } else {
      tx.oncomplete = () => resolve();
    }

    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }).finally(() => db.close());
}

async function loadHistory(userId) {
  const records = await withHistoryStore('readonly', (store) => store.getAll());
  return (Array.isArray(records) ? records : [])
    .filter((record) => record.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function getRecordImageCount(record) {
  return Math.max(1, Array.isArray(record.images) ? record.images.length : 0);
}

async function trimHistory(userId) {
  const records = await loadHistory(userId);
  const recordsToDelete = [];
  const recordsToUpdate = [];
  let imageCount = 0;

  records.forEach((record) => {
    const recordImageCount = getRecordImageCount(record);
    const remaining = DRAW_HISTORY_LIMIT - imageCount;

    if (remaining <= 0) {
      recordsToDelete.push(record);
      return;
    }

    if (recordImageCount > remaining) {
      recordsToUpdate.push({
        ...record,
        images: Array.isArray(record.images)
          ? record.images.slice(0, remaining)
          : record.images,
      });
      imageCount = DRAW_HISTORY_LIMIT;
      return;
    }

    imageCount += recordImageCount;
  });

  if (recordsToDelete.length > 0 || recordsToUpdate.length > 0) {
    await withHistoryStore('readwrite', (store) => {
      recordsToDelete.forEach((item) => store.delete(item.id));
      recordsToUpdate.forEach((item) => store.put(item));
    });
  }

  return loadHistory(userId);
}

async function saveHistory(record) {
  await withHistoryStore('readwrite', (store) => {
    store.put(record);
  });

  return trimHistory(record.userId);
}

async function deleteHistoryItem(id, userId) {
  await withHistoryStore('readwrite', (store) => {
    store.delete(id);
  });

  return trimHistory(userId);
}

async function clearUserHistory(userId) {
  const records = await loadHistory(userId);
  await withHistoryStore('readwrite', (store) => {
    records.forEach((record) => store.delete(record.id));
  });
}

function createHistoryId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isLikelyImageModel(model) {
  return /(^|[-_])(image|dall|mj|midjourney|sdxl|stable)([-_]|$)/i.test(model);
}

function base64ToBlob(b64, type = 'image/png') {
  const byteChars = atob(b64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  return new Blob([new Uint8Array(byteNumbers)], { type });
}

function downloadBase64Image(b64, filename) {
  const blob = base64ToBlob(b64);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function getImageSource(item) {
  if (!item) return '';
  return item.b64_json ? `data:image/png;base64,${item.b64_json}` : item.url || '';
}

async function imageItemToFile(item, filename) {
  if (item?.b64_json) {
    const blob = base64ToBlob(item.b64_json);
    return new File([blob], filename, { type: blob.type || 'image/png' });
  }

  if (item?.url) {
    const response = await fetch(item.url);
    if (!response.ok) throw new Error('无法读取历史图片');

    const blob = await response.blob();
    if (blob.type && !blob.type.startsWith('image/')) {
      throw new Error('历史记录不是有效图片');
    }
    return new File([blob], filename, { type: blob.type || 'image/png' });
  }

  throw new Error('无法读取历史图片');
}

function toDisplayItems(images, idPrefix, promptText = '') {
  return (Array.isArray(images) ? images : [])
    .slice(0, MAX_CONCURRENT_GENERATIONS)
    .map((image, index) => ({
      id: `${idPrefix}-${index}`,
      status: 'done',
      image,
      prompt: promptText,
    }));
}

function appendGenerationItem(current, newItem) {
  const next = [...current, newItem];
  if (next.length <= MAX_CONCURRENT_GENERATIONS) return next;

  const loadingItems = next.filter((item) => item.status === 'loading');
  const remainingSlots = Math.max(
    0,
    MAX_CONCURRENT_GENERATIONS - loadingItems.length,
  );
  const keptDoneItems =
    remainingSlots > 0
      ? next.filter((item) => item.status !== 'loading').slice(-remainingSlots)
      : [];
  const keptIds = new Set(
    [...loadingItems, ...keptDoneItems].map((item) => item.id),
  );

  return next.filter((item) => keptIds.has(item.id));
}

const drawGenerationSession = {
  activeGenerationCount: 0,
  generationItems: [],
  historyRecords: null,
  listeners: new Set(),
};

function getDrawGenerationSnapshot() {
  return {
    activeGenerationCount: drawGenerationSession.activeGenerationCount,
    generationItems: drawGenerationSession.generationItems,
    historyRecords: drawGenerationSession.historyRecords,
  };
}

function notifyDrawGenerationSession() {
  const snapshot = getDrawGenerationSnapshot();
  drawGenerationSession.listeners.forEach((listener) => listener(snapshot));
}

function subscribeDrawGenerationSession(listener) {
  drawGenerationSession.listeners.add(listener);
  listener(getDrawGenerationSnapshot());

  return () => {
    drawGenerationSession.listeners.delete(listener);
  };
}

function setSessionGenerationItems(updater) {
  drawGenerationSession.generationItems =
    typeof updater === 'function'
      ? updater(drawGenerationSession.generationItems)
      : updater;
  notifyDrawGenerationSession();
}

function setSessionActiveGenerationCount(count) {
  drawGenerationSession.activeGenerationCount = Math.max(0, count);
  notifyDrawGenerationSession();
}

function setSessionHistoryRecords(records) {
  drawGenerationSession.historyRecords = records;
  notifyDrawGenerationSession();
}

function incrementSessionActiveGenerationCount() {
  setSessionActiveGenerationCount(
    drawGenerationSession.activeGenerationCount + 1,
  );
}

function decrementSessionActiveGenerationCount() {
  setSessionActiveGenerationCount(
    drawGenerationSession.activeGenerationCount - 1,
  );
}

function cleanPolishedPrompt(content) {
  return String(content || '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```[\s\S]*?```/g, (match) =>
      match.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, ''),
    )
    .replace(/^\s*(润色结果|最终提示词|提示词)[:：]\s*/i, '')
    .trim();
}

const Draw = () => {
  const { t } = useTranslation();
  const userId = getCurrentUserId();
  const [savedSettings] = useState(() => readDrawSettings(userId));
  const [mode, setMode] = useState(() => getSavedMode(savedSettings));
  const [groups, setGroups] = useState([]);
  const [drawGroup, setDrawGroup] = useState(() =>
    getSavedString(savedSettings, 'drawGroup', DEFAULT_DRAW_GROUP),
  );
  const [drawModels, setDrawModels] = useState([]);
  const [drawModel, setDrawModel] = useState(() =>
    getSavedString(savedSettings, 'drawModel', DEFAULT_DRAW_MODEL),
  );
  const [polishGroup, setPolishGroup] = useState(() =>
    getSavedString(savedSettings, 'polishGroup', DEFAULT_POLISH_GROUP),
  );
  const [polishModels, setPolishModels] = useState([]);
  const [polishModel, setPolishModel] = useState(() =>
    getSavedString(savedSettings, 'polishModel', DEFAULT_POLISH_MODEL),
  );
  const [prompt, setPrompt] = useState(() =>
    getSavedString(savedSettings, 'prompt'),
  );
  const [size, setSize] = useState(() => getSavedSize(savedSettings));
  const [quality, setQuality] = useState(() => getSavedQuality(savedSettings));
  const [initialGenerationSession] = useState(() => getDrawGenerationSnapshot());
  const [sourceImages, setSourceImages] = useState([]);
  const [generationItems, setGenerationItems] = useState(
    initialGenerationSession.generationItems,
  );
  const [history, setHistory] = useState([]);
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [imagePreviewRecord, setImagePreviewRecord] = useState(null);
  const [activeGenerationCount, setActiveGenerationCount] = useState(
    initialGenerationSession.activeGenerationCount,
  );
  const [isPolishing, setIsPolishing] = useState(false);
  const [error, setError] = useState(null);

  const groupOptions = useMemo(
    () =>
      groups.map((item) => ({
        ...item,
        label: item.desc ? `${item.value} · ${item.desc}` : item.label,
      })),
    [groups],
  );

  const previewGridClass = useMemo(() => {
    if (generationItems.length === 1) return 'grid min-h-full place-items-center';
    if (generationItems.length === 2) {
      return 'grid min-h-full grid-cols-1 items-start gap-4 md:grid-cols-2';
    }
    return 'grid min-h-full grid-cols-1 items-start gap-4 md:grid-cols-3';
  }, [generationItems.length]);

  const previewItemClass = useMemo(
    () =>
      generationItems.length === 1 ? 'w-full max-w-3xl' : 'w-full',
    [generationItems.length],
  );

  const imagePreviewItems = useMemo(
    () =>
      imagePreviewRecord
        ? toDisplayItems(
            imagePreviewRecord.images,
            imagePreviewRecord.id,
            imagePreviewRecord.prompt || '',
          )
        : [],
    [imagePreviewRecord],
  );

  const imagePreviewGridClass = useMemo(() => {
    if (imagePreviewItems.length === 1) return 'grid place-items-center gap-4';
    if (imagePreviewItems.length === 2) {
      return 'grid grid-cols-1 gap-4 md:grid-cols-2';
    }
    return 'grid grid-cols-1 gap-4 md:grid-cols-3';
  }, [imagePreviewItems.length]);

  const imagePreviewItemClass = useMemo(
    () =>
      imagePreviewItems.length === 1 ? 'w-full max-w-2xl' : 'w-full',
    [imagePreviewItems.length],
  );

  const generateButtonText = useMemo(() => {
    if (activeGenerationCount >= MAX_CONCURRENT_GENERATIONS) {
      return t('最多同时生成3张');
    }
    return mode === 'edit' ? t('以图生成') : t('生成图片');
  }, [activeGenerationCount, mode, t]);

  const isGenerateDisabled = useMemo(
    () =>
      !prompt.trim() ||
      !drawGroup ||
      !drawModel ||
      activeGenerationCount >= MAX_CONCURRENT_GENERATIONS ||
      (mode === 'edit' && sourceImages.length === 0),
    [activeGenerationCount, drawGroup, drawModel, mode, prompt, sourceImages.length],
  );

  const loadGroupModels = useCallback(
    async (selectedGroup, setOptions, setSelectedModel, preferTextModel = false) => {
      if (!selectedGroup) {
        setOptions([]);
        setSelectedModel('');
        return;
      }

      const res = await API.get(
        `/api/user/models?group=${encodeURIComponent(selectedGroup)}`,
      );

      if (!res.data.success || !Array.isArray(res.data.data)) {
        setOptions([]);
        setSelectedModel('');
        return;
      }

      const options = toModelOptions(res.data.data);
      setOptions(options);
      setSelectedModel((current) => {
        if (options.some((item) => item.value === current)) return current;
        if (preferTextModel) {
          return (
            options.find((item) => !isLikelyImageModel(item.value))?.value ||
            options[0]?.value ||
            ''
          );
        }
        return options[0]?.value || '';
      });
    },
    [],
  );

  useEffect(
    () =>
      subscribeDrawGenerationSession((snapshot) => {
        setActiveGenerationCount(snapshot.activeGenerationCount);
        setGenerationItems(snapshot.generationItems);
        if (Array.isArray(snapshot.historyRecords)) {
          setHistory(snapshot.historyRecords);
        }
      }),
    [],
  );

  useEffect(() => {
    saveDrawSettings(userId, {
      mode,
      drawGroup,
      drawModel,
      polishGroup,
      polishModel,
      prompt,
      size,
      quality,
    });
  }, [
    drawGroup,
    drawModel,
    mode,
    polishGroup,
    polishModel,
    prompt,
    quality,
    size,
    userId,
  ]);

  useEffect(() => {
    API.get('/api/user/self/groups').then((res) => {
      if (res.data.success && res.data.data) {
        const groupList = Object.entries(res.data.data).map(([name, info]) => ({
          label: name,
          value: name,
          desc: info.desc,
        }));
        setGroups(groupList);
      }
    });
  }, []);

  useEffect(() => {
    loadGroupModels(drawGroup, setDrawModels, setDrawModel);
  }, [drawGroup, loadGroupModels]);

  useEffect(() => {
    loadGroupModels(polishGroup, setPolishModels, setPolishModel, true);
  }, [loadGroupModels, polishGroup]);

  useEffect(() => {
    trimHistory(userId)
      .then((records) => {
        setSessionHistoryRecords(records);
        if (getDrawGenerationSnapshot().generationItems.length === 0) {
          setSessionGenerationItems(
            toDisplayItems(
              records[0]?.images || [],
              records[0]?.id || 'history',
              records[0]?.prompt || '',
            ),
          );
        }
      })
      .catch(() => setHistory([]));
  }, [userId]);

  const handlePolishPrompt = useCallback(async () => {
    if (!prompt.trim() || !polishGroup || !polishModel) return;

    setIsPolishing(true);

    try {
      const res = await API.post(
        '/pg/chat/completions',
        {
          model: polishModel,
          group: polishGroup,
          messages: [
            {
              role: 'system',
              content:
                '你是图像生成提示词润色助手。请保留用户原意，补充清晰的主体、场景、构图、光线、材质、风格和画面细节。必须使用简体中文输出，只输出最终润色后的提示词正文。不要输出思考过程、解释、标题、Markdown、代码块、<thinking> 或 <think> 标签。',
            },
            {
              role: 'user',
              content: `请把下面的绘图提示词润色成适合图像生成的中文提示词，只返回润色后的正文：\n\n${prompt.trim()}`,
            },
          ],
          stream: false,
          temperature: 0.4,
        },
        { timeout: 60000 },
      );

      const polished = cleanPolishedPrompt(
        res.data?.choices?.[0]?.message?.content,
      );
      if (!polished) throw new Error(t('提示词润色失败'));
      setPrompt(polished);
      Toast.success(t('提示词已润色'));
    } catch (err) {
      Toast.error(err?.response?.data?.error?.message || err?.message || t('提示词润色失败'));
    } finally {
      setIsPolishing(false);
    }
  }, [polishGroup, polishModel, prompt, t]);

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || !drawGroup || !drawModel) return;
    if (mode === 'edit' && sourceImages.length === 0) {
      setError(t('请至少选择一张参考图片'));
      return;
    }
    if (
      getDrawGenerationSnapshot().activeGenerationCount >=
      MAX_CONCURRENT_GENERATIONS
    ) {
      Toast.warning(t('最多同时生成3张图片'));
      return;
    }

    const taskId = createHistoryId();
    const promptText = prompt.trim();
    const sourceImageNames = sourceImages.map((image) => image.name);

    incrementSessionActiveGenerationCount();
    setError(null);
    setSessionGenerationItems((current) =>
      appendGenerationItem(current, {
        id: taskId,
        status: 'loading',
        prompt: promptText,
        createdAt: Date.now(),
      }),
    );

    try {
      const requestConfig = { timeout: 300000 };
      const res =
        mode === 'edit'
          ? await API.post(
              '/pg/images/edits',
              (() => {
                const formData = new FormData();
                formData.append('model', drawModel);
                formData.append('prompt', promptText);
                formData.append('n', String(DRAW_GENERATION_COUNT));
                formData.append('size', size);
                formData.append('quality', quality);
                formData.append('group', drawGroup);
                formData.append('response_format', 'b64_json');
                const field = sourceImages.length > 1 ? 'image[]' : 'image';
                sourceImages.forEach((image) => formData.append(field, image));
                return formData;
              })(),
              requestConfig,
            )
          : await API.post(
              '/pg/images/generations',
              {
                model: drawModel,
                prompt: promptText,
                n: DRAW_GENERATION_COUNT,
                size,
                quality,
                group: drawGroup,
                response_format: 'b64_json',
              },
              requestConfig,
            );

      const data = res.data;
      if (data.error) {
        const msg =
          typeof data.error === 'object' ? data.error.message : String(data.error);
        throw new Error(msg || t('生成失败'));
      }
      if (!data.data || data.data.length === 0) {
        throw new Error(t('未返回图片'));
      }

      const resultImages = data.data.slice(0, DRAW_GENERATION_COUNT);
      setSessionGenerationItems((current) =>
        current.map((item) =>
          item.id === taskId
            ? {
                ...item,
                status: 'done',
                image: resultImages[0],
              }
            : item,
        ),
      );

      try {
        const records = await saveHistory({
          id: taskId,
          userId,
          createdAt: Date.now(),
          mode,
          model: drawModel,
          group: drawGroup,
          prompt: promptText,
          size,
          quality,
          n: DRAW_GENERATION_COUNT,
          images: resultImages,
          sourceImageNames,
        });
        setSessionHistoryRecords(records);
      } catch {
        Toast.error(t('无法保存图片历史'));
      }
      Toast.success(t('图片生成成功'));
    } catch (err) {
      const msg =
        err?.response?.data?.error?.message ||
        err?.message ||
        t('生成失败');
      setSessionGenerationItems((current) =>
        current.map((item) =>
          item.id === taskId
            ? {
                ...item,
                status: 'error',
                error: msg,
              }
            : item,
        ),
      );
      Toast.error(msg);
    } finally {
      decrementSessionActiveGenerationCount();
    }
  }, [drawGroup, drawModel, mode, prompt, quality, size, sourceImages, t, userId]);

  const handleDownload = useCallback((item, index) => {
    if (item.b64_json) {
      downloadBase64Image(item.b64_json, `image-${index + 1}.png`);
    } else if (item.url) {
      const a = document.createElement('a');
      a.href = item.url;
      a.download = `image-${index + 1}.png`;
      a.target = '_blank';
      a.click();
    }
  }, []);

  const handleUseImageForEdit = useCallback(
    async (image, record, index = 0) => {
      if (!image) return;

      try {
        const file = await imageItemToFile(
          image,
          `history-image-${record?.id || Date.now()}-${index + 1}.png`,
        );

        setMode('edit');
        setSourceImages((current) => [...current, file]);
        setHistoryPanelOpen(false);
        setImagePreviewRecord(null);
        setError(null);
        Toast.success(t('已添加为图生图参考图片'));
      } catch {
        Toast.error(t('这张历史图无法直接作为参考图'));
      }
    },
    [t],
  );

  const handleHideGenerationItem = useCallback((id) => {
    setSessionGenerationItems((current) =>
      current.filter((item) => item.id !== id),
    );
  }, []);

  const handleClearHistory = useCallback(async () => {
    if (!window.confirm(t('确认清空所有图片历史吗？'))) return;
    await clearUserHistory(userId);
    setSessionHistoryRecords([]);
    setHistoryPanelOpen(false);
    setImagePreviewRecord(null);
  }, [t, userId]);

  const handleOpenHistoryRecord = useCallback((record) => {
    setHistoryPanelOpen(false);
    setImagePreviewRecord(record);
  }, []);

  const handleOpenGenerationPreview = useCallback((item) => {
    if (item.status !== 'done' || !item.image) return;

    setImagePreviewRecord({
      id: item.id,
      mode,
      createdAt: item.createdAt || Date.now(),
      images: [item.image],
      prompt: item.prompt || '',
    });
  }, [mode]);

  const handleDeleteHistory = useCallback(
    async (id) => {
      const records = await deleteHistoryItem(id, userId);
      setSessionHistoryRecords(records);
      setImagePreviewRecord((current) =>
        current?.id === id ? null : current,
      );
    },
    [userId],
  );

  return (
    <>
      <div className='mt-[60px] grid gap-5 bg-[#f4f7f8] p-4 lg:grid-cols-[31rem_minmax(0,1fr)]' style={{ height: 'calc(100vh - 60px)' }}>
      <Card
        className='min-h-0 overflow-hidden rounded-xl border border-[#d9e2e7] bg-white shadow-sm'
        bodyStyle={{ height: '100%', padding: 0 }}
      >
        <div className='flex h-full min-h-0 flex-col'>
        <div className='flex items-center justify-between border-b border-[#edf1f3] px-5 py-4'>
          <Title heading={5} className='mb-0'>
            {t('绘图功能')}
          </Title>
          <div className='rounded-full border border-[#cfe3df] bg-[#eef8f5] px-3 py-1 text-xs font-medium text-[#0f766e]'>
            {activeGenerationCount}/{MAX_CONCURRENT_GENERATIONS}
          </div>
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto px-5 py-5'>
          <div className='flex flex-col gap-5'>
          <div className='rounded-lg border border-[#e3e9ed] bg-[#fafcfc] p-3'>
            <Text className='mb-2 block text-sm font-semibold text-[#27343b]'>{t('模式')}</Text>
            <Select
              value={mode}
              onChange={setMode}
              optionList={[
                { label: t('文生图'), value: 'generate' },
                { label: t('图生图'), value: 'edit' },
              ]}
              style={{ width: '100%' }}
            />
          </div>

          <div className='grid grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)] items-end gap-2 rounded-lg border border-[#e3e9ed] bg-[#fafcfc] p-3'>
            <Text className='pb-2 text-sm font-semibold text-[#27343b]'>{t('生图模型')}</Text>
            <div className='min-w-0'>
              <Text className='mb-1 block text-xs font-medium text-[#6b7a83]'>{t('分组选择')}</Text>
              <Select
                value={drawGroup}
                onChange={(value) => {
                  setDrawGroup(value);
                  setDrawModels([]);
                  setDrawModel('');
                }}
                optionList={groupOptions}
                placeholder={t('选择分组')}
                style={{ width: '100%' }}
                filter
              />
            </div>
            <div className='min-w-0'>
              <Text className='mb-1 block text-xs font-medium text-[#6b7a83]'>{t('模型选择')}</Text>
              <Select
                value={drawModel}
                onChange={setDrawModel}
                optionList={drawModels}
                placeholder={drawGroup ? t('选择模型') : t('请选择分组')}
                style={{ width: '100%' }}
                disabled={!drawGroup}
                filter
              />
            </div>
          </div>

          <div className='grid grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)] items-end gap-2 rounded-lg border border-[#e3e9ed] bg-[#fafcfc] p-3'>
            <Text className='pb-2 text-sm font-semibold text-[#27343b]'>{t('提示词模型')}</Text>
            <div className='min-w-0'>
              <Text className='mb-1 block text-xs font-medium text-[#6b7a83]'>{t('分组选择')}</Text>
              <Select
                value={polishGroup}
                onChange={(value) => {
                  setPolishGroup(value);
                  setPolishModels([]);
                  setPolishModel('');
                }}
                optionList={groupOptions}
                placeholder={t('选择分组')}
                style={{ width: '100%' }}
                filter
              />
            </div>
            <div className='min-w-0'>
              <Text className='mb-1 block text-xs font-medium text-[#6b7a83]'>{t('模型选择')}</Text>
              <Select
                value={polishModel}
                onChange={setPolishModel}
                optionList={polishModels}
                placeholder={polishGroup ? t('选择模型') : t('请选择分组')}
                style={{ width: '100%' }}
                disabled={!polishGroup}
                filter
              />
            </div>
          </div>

          <div className='rounded-lg border border-[#e3e9ed] bg-white p-3 shadow-sm'>
            <div className='mb-2 flex items-center justify-between'>
              <Text className='block text-sm font-semibold text-[#27343b]'>{t('提示词')}</Text>
              <Button
                size='small'
                className='rounded-md'
                icon={<WandSparkles size={14} />}
                loading={isPolishing}
                disabled={!prompt.trim() || !polishGroup || !polishModel}
                onClick={handlePolishPrompt}
              >
                {t('润色提示词')}
              </Button>
            </div>
            <TextArea
              value={prompt}
              onChange={setPrompt}
              placeholder={t('描述你想生成的图片...')}
              autosize={{ minRows: 6, maxRows: 12 }}
              maxCount={4000}
              className='rounded-lg'
            />
          </div>

          {mode === 'edit' && (
            <div className='rounded-lg border border-[#e3e9ed] bg-[#fafcfc] p-3'>
              <Text className='mb-2 block text-sm font-semibold text-[#27343b]'>{t('参考图片')}</Text>
              <input
                className='block w-full rounded-lg border border-dashed border-[#b9c7cf] bg-white px-3 py-2 text-sm text-[#334149]'
                type='file'
                accept={DRAW_IMAGE_ACCEPT}
                multiple
                onChange={(event) => {
                  setSourceImages(Array.from(event.target.files || []));
                  event.target.value = '';
                }}
              />
              {sourceImages.length > 0 && (
                <div className='mt-3 flex flex-col gap-2'>
                  {sourceImages.map((image, index) => (
                    <div
                      key={`${image.name}-${index}`}
                      className='flex items-center justify-between rounded-lg border border-[#e1e8ec] bg-white px-3 py-2 text-xs'
                    >
                      <span className='truncate'>{image.name}</span>
                      <Button
                        size='small'
                        type='tertiary'
                        onClick={() =>
                          setSourceImages((current) =>
                            current.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                      >
                        {t('移除')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className='grid grid-cols-2 gap-3'>
            <div className='rounded-lg border border-[#e3e9ed] bg-[#fafcfc] p-3'>
              <Text className='mb-2 block text-sm font-semibold text-[#27343b]'>{t('尺寸')}</Text>
              <Select
                value={size}
                onChange={setSize}
                optionList={SIZE_OPTIONS}
                style={{ width: '100%' }}
              />
            </div>
            <div className='rounded-lg border border-[#e3e9ed] bg-[#fafcfc] p-3'>
              <Text className='mb-2 block text-sm font-semibold text-[#27343b]'>{t('质量')}</Text>
              <Select
                value={quality}
                onChange={setQuality}
                optionList={QUALITY_OPTIONS.map((item) => ({
                  label: item,
                  value: item,
                }))}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          </div>
        </div>

          <div className='border-t border-[#edf1f3] bg-white px-5 py-4 shadow-[0_-8px_20px_rgba(15,23,42,0.05)]'>
            <Button
              theme='solid'
              type='primary'
              block
              className='h-11 rounded-lg text-base font-semibold shadow-sm'
              style={
                isGenerateDisabled
                  ? undefined
                  : { backgroundColor: '#0f766e', borderColor: '#0f766e' }
              }
              disabled={isGenerateDisabled}
              onClick={handleSubmit}
            >
              {generateButtonText}
            </Button>
            {activeGenerationCount > 0 && (
              <Text className='mt-2 block text-xs' type='tertiary'>
                {t('正在生成')} {activeGenerationCount}/{MAX_CONCURRENT_GENERATIONS}
                {'，'}
                {t('可继续点击直到同时生成3张图片')}
              </Text>
            )}
          </div>
        </div>
      </Card>

      <Card
        className='relative min-h-0 overflow-hidden rounded-xl border border-[#d9e2e7] bg-white shadow-sm'
        bodyStyle={{ height: '100%', padding: 20 }}
      >
        <div className='flex h-full min-h-0 flex-col'>
          <div className='mb-4 border-b border-[#edf1f3] pb-4 pr-14'>
            <div>
              <Title heading={5} className='mb-1 text-[#1f2a30]'>
                {t('生成预览')}
              </Title>
              <Text className='text-[#6b7a83]'>
                {t('最多同时生成3张图片')}
              </Text>
            </div>
          </div>

          <Button
            className='absolute right-5 top-5 rounded-full border border-[#cfe3df] bg-white px-3 py-2 text-[#111827] shadow-sm'
            icon={<History size={18} />}
            onClick={() => setHistoryPanelOpen((open) => !open)}
          >
            {t('历史记录')}
          </Button>

          {historyPanelOpen && (
            <div
              className='absolute right-5 top-20 z-50 w-[32rem] max-w-[calc(100%-2.5rem)] rounded-xl border border-[#d9e2e7] bg-white p-3 text-[#111827] shadow-xl'
              style={{ backgroundColor: '#ffffff', color: '#111827' }}
            >
              <div className='mb-1 flex items-center justify-between'>
                <Text strong className='text-[#111827]'>{t('历史记录')}</Text>
                <Button
                  size='small'
                  type='tertiary'
                  className='rounded-md'
                  icon={<Trash2 size={14} />}
                  disabled={history.length === 0}
                  onClick={handleClearHistory}
                >
                  {t('清空历史')}
                </Button>
              </div>
              <Text className='mb-3 block text-xs text-[#111827]'>
                {t('历史记录只保存最近10张图片，多余图片会自动删除')}
              </Text>
              {history.length === 0 ? (
                <div className='rounded-lg border border-dashed border-[#c7d2d8] bg-white p-3 text-center'>
                  <Text type='tertiary'>{t('暂无保存图片')}</Text>
                </div>
              ) : (
                <div className='flex max-h-44 flex-col gap-2 overflow-y-auto pr-1'>
                  {history.map((record) => {
                    const src = getImageSource(record.images?.[0]);
                    return (
                      <div key={record.id} className='rounded-lg border border-[#e1e8ec] bg-white p-2 transition-colors hover:border-[#8fcac0] hover:bg-[#f5fbfa]'>
                        <div className='flex gap-2'>
                          <button
                            type='button'
                            className='size-14 shrink-0 overflow-hidden rounded-lg border border-[#d7e0e5] bg-gray-50'
                            onClick={() => handleOpenHistoryRecord(record)}
                          >
                            {src ? (
                              <img src={src} alt='' className='size-full object-cover' />
                            ) : (
                              <ImageIcon size={20} />
                            )}
                          </button>
                          <button
                            type='button'
                            className='min-w-0 flex-1 text-left text-xs text-[#111827]'
                            onClick={() => handleOpenHistoryRecord(record)}
                          >
                            <div className='mb-1 text-[11px] text-[#111827]'>
                              {record.mode === 'edit' ? t('图生图') : t('文生图')}
                              {' · '}
                              {new Date(record.createdAt).toLocaleString()}
                            </div>
                            <div className='line-clamp-2'>{record.prompt}</div>
                          </button>
                          <div className='flex shrink-0 items-center gap-1'>
                            <Button
                              size='small'
                              type='tertiary'
                              className='rounded-md whitespace-nowrap'
                              icon={<WandSparkles size={14} />}
                              disabled={!src}
                              onClick={() =>
                                handleUseImageForEdit(record.images?.[0], record, 0)
                              }
                            >
                              {t('用于图生图')}
                            </Button>
                            <Button
                              size='small'
                              type='tertiary'
                              className='rounded-md'
                              icon={<Trash2 size={14} />}
                              onClick={() => handleDeleteHistory(record.id)}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className='min-h-0 flex-1 overflow-y-auto rounded-xl bg-[#f7fafb] p-4'>
            {error && (
              <div className='mb-3 rounded-lg border border-red-200 bg-red-50 p-3'>
                <Text type='danger'>{error}</Text>
              </div>
            )}

            {generationItems.length === 0 && (
              <div className='flex h-full min-h-[28rem] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[#c9d5dc] bg-white text-gray-400'>
                <div className='rounded-full bg-[#eef3f5] p-4'>
                  <ImageIcon size={56} strokeWidth={1} />
                </div>
                <Text className='text-[#7b8991]'>{t('生成的图片将显示在这里')}</Text>
              </div>
            )}

            {generationItems.length > 0 && (
              <div className={previewGridClass}>
                {generationItems.map((item, index) => {
                  const src = getImageSource(item.image);
                  return (
                    <div
                      key={item.id}
                      className={`${previewItemClass} group relative overflow-hidden rounded-xl border border-[#d9e2e7] bg-white shadow-sm transition-shadow hover:shadow-md`}
                    >
                      <Button
                        size='small'
                        type='tertiary'
                        className='absolute right-3 top-3 z-10 rounded-full bg-white/90 shadow-sm'
                        icon={<X size={14} />}
                        onClick={() => handleHideGenerationItem(item.id)}
                      />

                      {item.status === 'loading' && (
                        <div className='flex aspect-square min-h-[18rem] flex-col items-center justify-center gap-3 bg-[#f4f8f9] px-4 text-center'>
                          <Spin size='large' />
                          <Text className='text-[#6b7a83]'>
                            {t('生成图片时间约为1-2分钟请耐心等待')}
                          </Text>
                        </div>
                      )}

                      {item.status === 'error' && (
                        <div className='flex aspect-square min-h-[18rem] flex-col items-center justify-center gap-2 bg-red-50 px-4 text-center'>
                          <Text type='danger'>{item.error || t('生成失败')}</Text>
                        </div>
                      )}

                      {item.status === 'done' && (
                        <>
                          <img
                            src={src}
                            alt={`Generated ${index + 1}`}
                            className='w-full cursor-zoom-in object-contain'
                            onClick={() => handleOpenGenerationPreview(item)}
                          />
                          <div className='absolute right-14 top-3 opacity-0 transition-opacity group-hover:opacity-100'>
                            <Button
                              size='small'
                              className='rounded-md shadow-sm'
                              icon={<Download size={14} />}
                              onClick={() => handleDownload(item.image, index)}
                            >
                              {t('下载')}
                            </Button>
                          </div>
                          {item.prompt && (
                            <div className='border-t border-[#edf1f3] bg-white p-3'>
                              <Text size='small' className='text-[#5d6b73]'>
                                {item.prompt}
                              </Text>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
    <Modal
      title={t('图片预览')}
      visible={Boolean(imagePreviewRecord)}
      footer={null}
      width={960}
      contentStyle={{ backgroundColor: '#ffffff' }}
      bodyStyle={{ background: '#ffffff', color: '#111827' }}
      onCancel={() => setImagePreviewRecord(null)}
    >
      {imagePreviewRecord && (
        <div className='flex flex-col gap-4'>
          <div className='rounded-lg border border-[#e3e9ed] bg-white px-3 py-2 text-xs text-[#6b7a83]'>
            {imagePreviewRecord.mode === 'edit' ? t('图生图') : t('文生图')}
            {' · '}
            {new Date(imagePreviewRecord.createdAt).toLocaleString()}
          </div>
          <div className={imagePreviewGridClass}>
            {imagePreviewItems.map((item, index) => {
              const src = getImageSource(item.image);
              return (
                <div
                  key={item.id}
                  className={`${imagePreviewItemClass} overflow-hidden rounded-xl border border-[#d9e2e7] bg-white shadow-sm`}
                >
                  {src ? (
                    <img
                      src={src}
                      alt={`History ${index + 1}`}
                      className='w-full object-contain'
                    />
                  ) : (
                    <div className='flex aspect-square min-h-[16rem] items-center justify-center bg-[#f4f8f9]'>
                      <ImageIcon size={48} strokeWidth={1} />
                    </div>
                  )}
                  <div className='flex items-start justify-between gap-3 border-t border-[#edf1f3] bg-white p-3'>
                    <Text size='small' className='min-w-0 flex-1 text-[#5d6b73]'>
                      {item.prompt}
                    </Text>
                    <div className='flex shrink-0 flex-wrap justify-end gap-2'>
                      <Button
                        size='small'
                        className='rounded-md'
                        icon={<WandSparkles size={14} />}
                        onClick={() =>
                          handleUseImageForEdit(item.image, imagePreviewRecord, index)
                        }
                      >
                        {t('用于图生图')}
                      </Button>
                      <Button
                        size='small'
                        className='rounded-md'
                        icon={<Download size={14} />}
                        onClick={() => handleDownload(item.image, index)}
                      >
                        {t('下载')}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
    </>
  );
};

export default Draw;
