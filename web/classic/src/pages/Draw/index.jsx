import React, { useState, useCallback, useEffect } from 'react';
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
import { Download, ImageIcon } from 'lucide-react';
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

// PLACEHOLDER_COMPONENT

const Draw = () => {
  const { t } = useTranslation();
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('gpt-image-1');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [quality, setQuality] = useState('auto');
  const [n, setN] = useState(1);
  const [images, setImages] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    API.get('/api/user/models').then((res) => {
      if (res.data.success && Array.isArray(res.data.data)) {
        setModels(res.data.data.map((m) => ({ label: m, value: m })));
      }
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || !model) return;
    setIsGenerating(true);
    setError(null);
    setImages([]);

    try {
      const res = await API.post('/pg/images/generations', {
        model,
        prompt: prompt.trim(),
        n,
        size,
        quality,
        response_format: 'b64_json',
      }, { timeout: 300000 });

      const data = res.data;
      if (data.error) {
        const msg = typeof data.error === 'object'
          ? data.error.message
          : String(data.error);
        setError(msg || t('生成失败'));
        return;
      }
      if (!data.data || data.data.length === 0) {
        setError(t('未返回图片'));
        return;
      }
      setImages(data.data);
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
  }, [model, prompt, n, size, quality, t]);

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

  return (
    <div className='flex gap-4 p-4' style={{ height: 'calc(100vh - 60px)' }}>
      {/* 左侧控制面板 */}
      <Card className='w-80 shrink-0 overflow-y-auto'>
        <Title heading={5} className='mb-4'>{t('绘图功能')}</Title>

        <div className='flex flex-col gap-4'>
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
            <Text className='mb-1 block text-sm font-medium'>{t('提示词')}</Text>
            <TextArea
              value={prompt}
              onChange={setPrompt}
              placeholder={t('描述你想生成的图片...')}
              autosize={{ minRows: 6, maxRows: 12 }}
              maxCount={4000}
            />
          </div>

          <div className='grid grid-cols-2 gap-3'>
            <div>
              <Text className='mb-1 block text-sm font-medium'>{t('尺寸')}</Text>
              <Select
                value={size}
                onChange={setSize}
                optionList={SIZE_OPTIONS.map((s) => ({ label: s, value: s }))}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <Text className='mb-1 block text-sm font-medium'>{t('质量')}</Text>
              <Select
                value={quality}
                onChange={setQuality}
                optionList={QUALITY_OPTIONS.map((q) => ({ label: q, value: q }))}
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
            disabled={!prompt.trim()}
            onClick={handleSubmit}
          >
            {isGenerating ? t('生成中...') : t('生成图片')}
          </Button>
        </div>
      </Card>

      {/* 右侧结果区域 */}
      <Card className='flex-1 overflow-y-auto'>
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
              const src = item.b64_json
                ? `data:image/png;base64,${item.b64_json}`
                : item.url || '';
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
                      <Text size='small' type='tertiary'>{item.revised_prompt}</Text>
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
