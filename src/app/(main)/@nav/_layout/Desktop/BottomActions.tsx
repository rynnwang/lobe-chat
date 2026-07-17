import { SiGithub } from '@icons-pack/react-simple-icons';
import { ActionIcon } from '@lobehub/ui';
import { Book } from 'lucide-react';
import Link from 'next/link';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DOCUMENTS_REFER_URL, GITHUB } from '@/const/url';

const BottomActions = memo(() => {
  const { t } = useTranslation('common');

  return (
    <>
      <Link aria-label={'GitHub'} href={GITHUB} target={'_blank'}>
        <ActionIcon icon={SiGithub as any} placement={'right'} title={'GitHub'} />
      </Link>
      <Link aria-label={t('document')} href={DOCUMENTS_REFER_URL} target={'_blank'}>
        <ActionIcon icon={Book} placement={'right'} title={t('document')} />
      </Link>
    </>
  );
});

export default BottomActions;
