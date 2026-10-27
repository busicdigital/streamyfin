import { useSeerr } from "@/hooks/useSeerr";
import { useSeerrPublicSettings } from "@/hooks/useSeerrPublicSettings";
import { hasPermission, Permission } from "@/utils/seerr/permissions";
import { requestOffer } from "@/utils/seerr/requests";
import {
  MediaType,
  type MovieDetails,
  type MovieResult,
  type TvDetails,
  type TvResult,
} from "@/utils/seerr/types";

/**
 * What a title's page offers to request, the phone's and the TV's from one
 * rule (requestOffer), with the server's settings the season lists read.
 * The 4K offer stands beside the standard one, as Seerr's own buttons do,
 * where the server has a default 4K service for the kind of title.
 */
export const useSeerrRequestOffer = (
  details: MovieResult | TvResult | MovieDetails | TvDetails | undefined,
  mediaType: MediaType | undefined,
) => {
  const { seerrUser } = useSeerr();
  const publicSettings = useSeerrPublicSettings();
  const specials = publicSettings?.enableSpecialEpisodes === true;
  const partial = publicSettings?.partialRequestsEnabled !== false;
  const permissions = seerrUser?.permissions ?? 0;
  const fourKEnabled =
    mediaType === MediaType.MOVIE
      ? publicSettings?.movie4kEnabled === true
      : publicSettings?.series4kEnabled === true;
  const offer4k = fourKEnabled
    ? requestOffer(details, mediaType, permissions, { specials, is4k: true })
    : undefined;

  return {
    ...requestOffer(details, mediaType, permissions, { specials }),
    requestMore4k: offer4k?.requestMore === true,
    offersRequest4k: offer4k?.offersRequest === true,
    hasAdvancedRequestPermission:
      !!seerrUser &&
      hasPermission(
        [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
        permissions,
        { type: "or" },
      ),
    specials,
    partial,
  };
};
