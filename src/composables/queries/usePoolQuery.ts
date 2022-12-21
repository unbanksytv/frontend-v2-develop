import { QueryObserverOptions } from 'react-query/core';
import { computed, reactive, Ref, ref } from 'vue';
import { useQuery } from 'vue-query';
import { GraphQLArgs } from '@balancer-labs/sdk';

import useTokens from '@/composables/useTokens';
import QUERY_KEYS from '@/constants/queryKeys';

import { poolsStoreService } from '@/services/pool/pools-store.service';
import { Pool } from '@/services/pool/types';
import useWeb3 from '@/services/web3/useWeb3';

import PoolRepository from '@/services/pool/pool.repository';
import { configService } from '@/services/config/config.service';
import { isBlocked, tokenTreeLeafs } from '../usePool';
import useGaugesQuery from './useGaugesQuery';
import { POOLS } from '@/constants/pools';
import { PoolDecorator } from '@/services/pool/decorators/pool.decorator';

export default function usePoolQuery(
  id: string,
  isEnabled: Ref<boolean> = ref(true),
  options: QueryObserverOptions<Pool> = {}
) {
  /**
   * @description
   * If pool is already downloaded, we can use it instantly
   * it may be if user came to pool page from home page
   */
  const poolInfo = poolsStoreService.findPool(id);
  /**
   * COMPOSABLES
   */
  const { injectTokens, dynamicDataLoading, tokens } = useTokens();
  const { account } = useWeb3();
  const { data: subgraphGauges } = useGaugesQuery();
  const gaugeAddresses = computed(() =>
    (subgraphGauges.value || []).map(gauge => gauge.id)
  );

  const poolRepository = new PoolRepository(tokens);

  /**
   * COMPUTED
   */
  const enabled = computed(() => !dynamicDataLoading.value && isEnabled.value);

  /**
   * METHODS
   */

  function getQueryArgs(): GraphQLArgs {
    const queryArgs: GraphQLArgs = {
      chainId: configService.network.chainId,
      where: {
        id: { eq: id?.toLowerCase() },
        totalShares: { gt: -1 }, // Avoid the filtering for low liquidity pools
        poolType: { not_in: POOLS.ExcludedPoolTypes },
      },
    };
    return queryArgs;
  }

  /**
   * QUERY INPUTS
   */
  const queryKey = QUERY_KEYS.Pools.Current(id, gaugeAddresses);

  const queryFn = async () => {
    let pool: Pool;
    if (poolInfo) {
      pool = poolInfo;
    } else {
      pool = await poolRepository.fetch(getQueryArgs());
    }

    if (!pool) throw new Error('Pool does not exist');

    if (isBlocked(pool, account.value)) throw new Error('Pool not allowed');

    // If the pool is cached from homepage it may not have onchain set, so update it
    if (!pool.onchain) {
      const poolDecorator = new PoolDecorator([pool]);
      [pool] = await poolDecorator.decorate(tokens.value, false);
    }

    // Inject pool tokens into token registry
    await injectTokens([
      ...pool.tokensList,
      ...tokenTreeLeafs(pool.tokens),
      pool.address,
    ]);

    return pool;
  };

  const queryOptions = reactive({
    enabled,
    ...options,
  });

  return useQuery<Pool>(queryKey, queryFn, queryOptions);
}
