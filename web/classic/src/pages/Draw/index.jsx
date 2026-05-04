import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  TextArea,
  Select,
  Card,
  Typography,
  Spin,
  Toast,
} from '@douyinfe/semi-ui';
import { Download, ImageIcon, Trash2, WandSparkles } from 'lucide-react';
import { API } from '../../helpers/api';

const { Title, Text } = Typography;

const SIZE_OPTIONS = [
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '2048x2048',
  '2880x2880',
  '3840x2160',
  '2160x3840',
];

const QUALITY_OPTIONS = ['high', 'medium', 'low', 'auto'];
const DRAW_HISTORY_LIMIT = 5;
const DRAW_GENERATION_COUNT = 1;
const MAX_CONCURRENT_GENERATIONS = 3;
const DRAW_HISTORY_DB = 'new-api-classic-draw-history';
const DRAW_HISTORY_STORE = 'records';
const DRAW_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';

function toModelOptions(models) {
  return (Array.isArray(models) ? models : []).map((item) => ({
    label: item,
    value: item,
  }));
}

function getCurrentUserId() {
  return localStorage.getItem('uid') || 'anonymous';
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

function downloadBase64Image(b64, filename) {
  const byteChars = atob(b64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'image/png' });
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

function toDisplayItems(images, idPrefix) {
  return (Array.isArray(images) ? images : [])
    .slice(0, MAX_CONCURRENT_GENERATIONS)
    .map((image, index) => ({
      id: `${idPrefix}-${index}`,
      status: 'done',
      image,
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

const Draw = () => {
  const { t } = useTranslation();
  const userId = getCurrentUserId();
  const [mode, setMode] = useState('generate');
  const [groups, setGroups] = useState([]);
  const [drawGroup, setDrawGroup] = useState('');
  const [drawModels, setDrawModels] = useState([]);
  const [drawModel, setDrawModel] = useState('');
  const [polishGroup, setPolishGroup] = useState('');
  const [polishModels, setPolishModels] = useState([]);
  const [polishModel, setPolishModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [quality, setQuality] = useState('auto');
  const [sourceImages, setSourceImages] = useState([]);
  const [generationItems, setGenerationItems] = useState([]);
  const [history, setHistory] = useState([]);
  const [activeGenerationCount, setActiveGenerationCount] = useState(0);
  const [isPolishing, setIsPolishing] = useState(false);
  const [error, setError] = useState(null);
  const activeGenerationCountRef = useRef(0);

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
      return 'grid min-h-full grid-cols-1 items-center gap-4 md:grid-cols-2';
    }
    return 'grid min-h-full grid-cols-1 items-center gap-4 md:grid-cols-3';
  }, [generationItems.length]);

  const previewItemClass = useMemo(
    () =>
      generationItems.length === 1 ? 'w-full max-w-3xl' : 'w-full',
    [generationItems.length],
  );

  const generateButtonText = useMemo(() => {
    if (activeGenerationCount >= MAX_CONCURRENT_GENERATIONS) {
      return t('最多同时生成3张');
    }
    return mode === 'edit' ? t('以图生成') : t('生成图片');
  }, [activeGenerationCount, mode, t]);

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
        setHistory(records);
        setGenerationItems(
          toDisplayItems(records[0]?.images || [], records[0]?.id || 'history'),
        );
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
                'You polish prompts for image generation. Preserve the user intent, remove ambiguity, add useful visual detail, and return only the polished prompt.',
            },
            {
              role: 'user',
              content: prompt.trim(),
            },
          ],
          stream: false,
          temperature: 0.4,
        },
        { timeout: 60000 },
      );

      const polished = res.data?.choices?.[0]?.message?.content?.trim();
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
    if (activeGenerationCountRef.current >= MAX_CONCURRENT_GENERATIONS) {
      Toast.warning(t('最多同时生成3张图片'));
      return;
    }

    const taskId = createHistoryId();
    const promptText = prompt.trim();
    const sourceImageNames = sourceImages.map((image) => image.name);

    activeGenerationCountRef.current += 1;
    setActiveGenerationCount(activeGenerationCountRef.current);
    setError(null);
    setGenerationItems((current) =>
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
      setGenerationItems((current) =>
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
        setHistory(records);
      } catch {
        Toast.error(t('无法保存图片历史'));
      }
      Toast.success(t('图片生成成功'));
    } catch (err) {
      const msg =
        err?.response?.data?.error?.message ||
        err?.message ||
        t('生成失败');
      setGenerationItems((current) =>
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
      activeGenerationCountRef.current = Math.max(
        0,
        activeGenerationCountRef.current - 1,
      );
      setActiveGenerationCount(activeGenerationCountRef.current);
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

  const handleClearHistory = useCallback(async () => {
    if (!window.confirm(t('确认清空所有图片历史吗？'))) return;
    await clearUserHistory(userId);
    setHistory([]);
  }, [t, userId]);

  const handleOpenHistoryRecord = useCallback((record) => {
    setError(null);
    setGenerationItems(toDisplayItems(record.images, record.id));
  }, []);

  const handleDeleteHistory = useCallback(
    async (id) => {
      const records = await deleteHistoryItem(id, userId);
      setHistory(records);
    },
    [userId],
  );

  return (
    <div className='mt-[60px] grid gap-4 p-4 lg:grid-cols-[32rem_minmax(0,1fr)]' style={{ height: 'calc(100vh - 60px)' }}>
      <Card className='min-h-0 overflow-y-auto'>
        <Title heading={5} className='mb-4'>
          {t('绘图功能')}
        </Title>

        <div className='flex flex-col gap-4'>
          <div>
            <Text className='mb-1 block text-sm font-medium'>{t('模式')}</Text>
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

          <div className='grid grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)] items-end gap-2'>
            <Text className='pb-2 text-sm font-medium'>{t('生图模型')}</Text>
            <div className='min-w-0'>
              <Text className='mb-1 block text-xs text-gray-500'>{t('分组选择')}</Text>
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
              <Text className='mb-1 block text-xs text-gray-500'>{t('模型选择')}</Text>
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

          <div className='grid grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)] items-end gap-2'>
            <Text className='pb-2 text-sm font-medium'>{t('提示词模型')}</Text>
            <div className='min-w-0'>
              <Text className='mb-1 block text-xs text-gray-500'>{t('分组选择')}</Text>
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
              <Text className='mb-1 block text-xs text-gray-500'>{t('模型选择')}</Text>
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

          <div>
            <div className='mb-1 flex items-center justify-between'>
              <Text className='block text-sm font-medium'>{t('提示词')}</Text>
              <Button
                size='small'
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
            />
          </div>

          {mode === 'edit' && (
            <div>
              <Text className='mb-1 block text-sm font-medium'>{t('参考图片')}</Text>
              <input
                type='file'
                accept={DRAW_IMAGE_ACCEPT}
                multiple
                onChange={(event) => {
                  setSourceImages(Array.from(event.target.files || []));
                  event.target.value = '';
                }}
              />
              {sourceImages.length > 0 && (
                <div className='mt-2 flex flex-col gap-1'>
                  {sourceImages.map((image, index) => (
                    <div
                      key={`${image.name}-${index}`}
                      className='flex items-center justify-between rounded border px-2 py-1 text-xs'
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
            <div>
              <Text className='mb-1 block text-sm font-medium'>{t('尺寸')}</Text>
              <Select
                value={size}
                onChange={setSize}
                optionList={SIZE_OPTIONS.map((item) => ({ label: item, value: item }))}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <Text className='mb-1 block text-sm font-medium'>{t('质量')}</Text>
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

          <div>
            <Button
              theme='solid'
              type='primary'
              block
              disabled={
                !prompt.trim() ||
                !drawGroup ||
                !drawModel ||
                activeGenerationCount >= MAX_CONCURRENT_GENERATIONS ||
                (mode === 'edit' && sourceImages.length === 0)
              }
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

      <Card className='min-h-0 overflow-hidden'>
        <div className='flex h-full min-h-0 flex-col'>
          <div className='mb-4 flex flex-col gap-3 border-b pb-3 xl:flex-row xl:items-start xl:justify-between'>
            <div>
              <Title heading={5} className='mb-1'>
                {t('生成预览')}
              </Title>
              <Text type='tertiary'>
                {t('最多同时生成3张图片')}
              </Text>
            </div>

            <div className='w-full xl:w-[24rem]'>
              <div className='mb-1 flex items-center justify-between'>
                <Text strong>{t('历史记录')}</Text>
                <Button
                  size='small'
                  type='tertiary'
                  icon={<Trash2 size={14} />}
                  disabled={history.length === 0}
                  onClick={handleClearHistory}
                >
                  {t('清空历史')}
                </Button>
              </div>
              <Text className='mb-2 block text-xs' type='tertiary'>
                {t('历史记录只保存最近5张图片，多余图片会自动删除')}
              </Text>
              {history.length === 0 ? (
                <div className='rounded border border-dashed p-3 text-center'>
                  <Text type='tertiary'>{t('暂无保存图片')}</Text>
                </div>
              ) : (
                <div className='flex max-h-40 flex-col gap-2 overflow-y-auto pr-1'>
                  {history.map((record) => {
                    const src = getImageSource(record.images?.[0]);
                    return (
                      <div key={record.id} className='rounded border p-2'>
                        <div className='flex gap-2'>
                          <button
                            type='button'
                            className='size-14 shrink-0 overflow-hidden rounded border bg-gray-50'
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
                            className='min-w-0 flex-1 text-left text-xs'
                            onClick={() => handleOpenHistoryRecord(record)}
                          >
                            <div className='mb-1 text-[11px] text-gray-500'>
                              {record.mode === 'edit' ? t('图生图') : t('文生图')}
                              {' · '}
                              {new Date(record.createdAt).toLocaleString()}
                            </div>
                            <div className='line-clamp-2'>{record.prompt}</div>
                          </button>
                          <Button
                            size='small'
                            type='tertiary'
                            icon={<Trash2 size={14} />}
                            onClick={() => handleDeleteHistory(record.id)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className='min-h-0 flex-1 overflow-y-auto'>
            {error && (
              <div className='mb-3 rounded border border-red-200 bg-red-50 p-3'>
                <Text type='danger'>{error}</Text>
              </div>
            )}

            {generationItems.length === 0 && (
              <div className='flex h-full min-h-[28rem] flex-col items-center justify-center gap-3 text-gray-400'>
                <ImageIcon size={64} strokeWidth={1} />
                <Text type='tertiary'>{t('生成的图片将显示在这里')}</Text>
              </div>
            )}

            {generationItems.length > 0 && (
              <div className={previewGridClass}>
                {generationItems.map((item, index) => {
                  const src = getImageSource(item.image);
                  return (
                    <div
                      key={item.id}
                      className={`${previewItemClass} group relative overflow-hidden rounded-lg border bg-white`}
                    >
                      {item.status === 'loading' && (
                        <div className='flex aspect-square min-h-[18rem] flex-col items-center justify-center gap-3 bg-gray-50 px-4 text-center'>
                          <Spin size='large' />
                          <Text type='tertiary'>
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
                            className='w-full object-contain'
                          />
                          <div className='absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100'>
                            <Button
                              size='small'
                              icon={<Download size={14} />}
                              onClick={() => handleDownload(item.image, index)}
                            >
                              {t('下载')}
                            </Button>
                          </div>
                          {item.image?.revised_prompt && (
                            <div className='border-t bg-white/80 p-2'>
                              <Text size='small' type='tertiary'>
                                {item.image.revised_prompt}
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
  );
};

export default Draw;
