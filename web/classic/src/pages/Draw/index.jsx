import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  TextArea,
  Select,
  InputNumber,
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
const DRAW_HISTORY_LIMIT = 30;
const DRAW_HISTORY_DB = 'new-api-classic-draw-history';
const DRAW_HISTORY_STORE = 'records';
const DRAW_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';

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

async function saveHistory(record) {
  await withHistoryStore('readwrite', (store) => {
    store.put(record);
  });

  const records = await loadHistory(record.userId);
  const staleRecords = records.slice(DRAW_HISTORY_LIMIT);

  if (staleRecords.length > 0) {
    await withHistoryStore('readwrite', (store) => {
      staleRecords.forEach((item) => store.delete(item.id));
    });
  }

  return loadHistory(record.userId);
}

async function deleteHistoryItem(id, userId) {
  await withHistoryStore('readwrite', (store) => {
    store.delete(id);
  });

  return loadHistory(userId);
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

const Draw = () => {
  const { t } = useTranslation();
  const userId = getCurrentUserId();
  const [mode, setMode] = useState('generate');
  const [models, setModels] = useState([]);
  const [groups, setGroups] = useState([]);
  const [model, setModel] = useState('gpt-image-1');
  const [polishModel, setPolishModel] = useState('');
  const [group, setGroup] = useState('GPT');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [quality, setQuality] = useState('auto');
  const [n, setN] = useState(1);
  const [sourceImages, setSourceImages] = useState([]);
  const [images, setImages] = useState([]);
  const [history, setHistory] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPolishing, setIsPolishing] = useState(false);
  const [error, setError] = useState(null);

  const preferredPolishModel = useMemo(() => {
    const textModel = models.find((item) => !isLikelyImageModel(item.value));
    return textModel?.value || models[0]?.value || '';
  }, [models]);

  useEffect(() => {
    API.get('/api/user/models').then((res) => {
      if (res.data.success && Array.isArray(res.data.data)) {
        const modelOptions = res.data.data.map((item) => ({
          label: item,
          value: item,
        }));
        setModels(modelOptions);
        setModel((current) =>
          modelOptions.find((item) => item.value === current)
            ? current
            : modelOptions[0]?.value || 'gpt-image-1',
        );
      }
    });

    API.get('/api/user/self/groups').then((res) => {
      if (res.data.success && res.data.data) {
        const groupList = Object.entries(res.data.data).map(([name, info]) => ({
          label: name,
          value: name,
          desc: info.desc,
        }));
        setGroups(groupList);
        setGroup((current) =>
          groupList.find((item) => item.value === current)
            ? current
            : groupList[0]?.value || 'GPT',
        );
      }
    });
  }, []);

  useEffect(() => {
    loadHistory(userId)
      .then((records) => {
        setHistory(records);
        setImages(records[0]?.images || []);
      })
      .catch(() => setHistory([]));
  }, [userId]);

  useEffect(() => {
    if (!polishModel && preferredPolishModel) {
      setPolishModel(preferredPolishModel);
    }
  }, [polishModel, preferredPolishModel]);

  const handlePolishPrompt = useCallback(async () => {
    if (!prompt.trim() || !polishModel) return;

    setIsPolishing(true);

    try {
      const res = await API.post(
        '/pg/chat/completions',
        {
          model: polishModel,
          group,
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
  }, [group, polishModel, prompt, t]);

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || !model) return;
    if (mode === 'edit' && sourceImages.length === 0) {
      setError(t('请至少选择一张参考图片'));
      return;
    }

    setIsGenerating(true);
    setError(null);
    setImages([]);

    try {
      const requestConfig = { timeout: 300000 };
      const res =
        mode === 'edit'
          ? await API.post(
              '/pg/images/edits',
              (() => {
                const formData = new FormData();
                formData.append('model', model);
                formData.append('prompt', prompt.trim());
                formData.append('n', String(n));
                formData.append('size', size);
                formData.append('quality', quality);
                formData.append('group', group);
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
                model,
                prompt: prompt.trim(),
                n,
                size,
                quality,
                group,
                response_format: 'b64_json',
              },
              requestConfig,
            );

      const data = res.data;
      if (data.error) {
        const msg =
          typeof data.error === 'object' ? data.error.message : String(data.error);
        setError(msg || t('生成失败'));
        return;
      }
      if (!data.data || data.data.length === 0) {
        setError(t('未返回图片'));
        return;
      }

      setImages(data.data);
      try {
        const records = await saveHistory({
          id: createHistoryId(),
          userId,
          createdAt: Date.now(),
          mode,
          model,
          group,
          prompt: prompt.trim(),
          size,
          quality,
          n,
          images: data.data,
          sourceImageNames: sourceImages.map((image) => image.name),
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
      setError(msg);
    } finally {
      setIsGenerating(false);
    }
  }, [group, mode, model, n, prompt, quality, size, sourceImages, t, userId]);

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

  const handleDeleteHistory = useCallback(
    async (id) => {
      const records = await deleteHistoryItem(id, userId);
      setHistory(records);
    },
    [userId],
  );

  return (
    <div className='mt-[60px] grid gap-4 p-4 lg:grid-cols-[22rem_minmax(0,1fr)]' style={{ height: 'calc(100vh - 60px)' }}>
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

          <div>
            <Text className='mb-1 block text-sm font-medium'>{t('分组')}</Text>
            <Select
              value={group}
              onChange={setGroup}
              optionList={groups}
              placeholder={t('选择分组')}
              style={{ width: '100%' }}
              filter
            />
          </div>

          <div>
            <Text className='mb-1 block text-sm font-medium'>{t('模型')}</Text>
            <Select
              value={model}
              onChange={setModel}
              optionList={models}
              placeholder={t('选择模型')}
              style={{ width: '100%' }}
              filter
            />
          </div>

          <div>
            <Text className='mb-1 block text-sm font-medium'>{t('提示词模型')}</Text>
            <Select
              value={polishModel}
              onChange={setPolishModel}
              optionList={models}
              placeholder={t('选择模型')}
              style={{ width: '100%' }}
              filter
            />
          </div>

          <div>
            <div className='mb-1 flex items-center justify-between'>
              <Text className='block text-sm font-medium'>{t('提示词')}</Text>
              <Button
                size='small'
                icon={<WandSparkles size={14} />}
                loading={isPolishing}
                disabled={!prompt.trim() || !polishModel}
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
            <Text className='mb-1 block text-sm font-medium'>{t('数量')}</Text>
            <InputNumber
              value={n}
              onChange={setN}
              min={1}
              max={4}
              style={{ width: '100%' }}
            />
          </div>

          <Button
            theme='solid'
            type='primary'
            block
            loading={isGenerating}
            disabled={!prompt.trim() || (mode === 'edit' && sourceImages.length === 0)}
            onClick={handleSubmit}
          >
            {mode === 'edit' ? t('以图生成') : t('生成图片')}
          </Button>

          <div className='border-t pt-4'>
            <div className='mb-2 flex items-center justify-between'>
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
            {history.length === 0 ? (
              <div className='rounded border border-dashed p-4 text-center'>
                <Text type='tertiary'>{t('暂无保存图片')}</Text>
              </div>
            ) : (
              <div className='flex max-h-72 flex-col gap-2 overflow-y-auto pr-1'>
                {history.map((record) => {
                  const src = getImageSource(record.images[0]);
                  return (
                    <div key={record.id} className='rounded border p-2'>
                      <div className='flex gap-2'>
                        <button
                          type='button'
                          className='size-14 shrink-0 overflow-hidden rounded border bg-gray-50'
                          onClick={() => {
                            setError(null);
                            setImages(record.images);
                          }}
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
                          onClick={() => {
                            setError(null);
                            setImages(record.images);
                          }}
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
      </Card>

      <Card className='min-h-0 overflow-y-auto'>
        {error && (
          <div className='flex h-full items-center justify-center'>
            <Text type='danger'>{error}</Text>
          </div>
        )}

        {!error && images.length === 0 && (
          <div className='flex h-full flex-col items-center justify-center gap-3 text-gray-400'>
            {isGenerating ? (
              <Spin size='large' />
            ) : (
              <>
                <ImageIcon size={64} strokeWidth={1} />
                <Text type='tertiary'>{t('生成的图片将显示在这里')}</Text>
              </>
            )}
          </div>
        )}

        {images.length > 0 && (
          <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
            {images.map((item, index) => {
              const src = getImageSource(item);
              return (
                <div key={index} className='group relative overflow-hidden rounded-lg border'>
                  <img src={src} alt={`Generated ${index + 1}`} className='w-full object-contain' />
                  <div className='absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100'>
                    <Button
                      size='small'
                      icon={<Download size={14} />}
                      onClick={() => handleDownload(item, index)}
                    >
                      {t('下载')}
                    </Button>
                  </div>
                  {item.revised_prompt && (
                    <div className='border-t bg-white/80 p-2'>
                      <Text size='small' type='tertiary'>
                        {item.revised_prompt}
                      </Text>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};

export default Draw;
