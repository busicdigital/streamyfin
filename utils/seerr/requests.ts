import { mediaTypeOf } from "./media";
import { hasPermission, Permission } from "./permissions";
import { unrequestedSeasons } from "./seasons";
import {
  type MediaInfo,
  type MediaRequest,
  MediaRequestStatus,
  MediaStatus,
  MediaType,
  type MovieDetails,
  type MovieResult,
  type PersonCreditCast,
  type ServiceCommonServer,
  type TvDetails,
  type TvResult,
} from "./types";

/** Standard or 4K: Seerr keeps a status and requests for each copy apart. */
export interface RequestTier {
  is4k?: boolean;
}

/** The library's status of the tier's copy. */
const tierStatus = (
  media: MediaInfo | undefined,
  is4k: boolean,
): MediaStatus | undefined => (is4k ? media?.status4k : media?.status);

/** The requests made for the tier's copy only. */
const tierRequests = (
  media: MediaInfo | undefined,
  is4k: boolean,
): MediaRequest[] =>
  (media?.requests ?? []).filter((request) => !!request.is4k === is4k);

/** The permissions that let someone ask for a kind of title in a tier. */
const requestPermissions = (
  mediaType: MediaType | undefined,
  is4k: boolean,
) => {
  const movie = mediaType === MediaType.MOVIE;
  return is4k
    ? [
        Permission.REQUEST_4K,
        movie ? Permission.REQUEST_4K_MOVIE : Permission.REQUEST_4K_TV,
      ]
    : [
        Permission.REQUEST,
        movie ? Permission.REQUEST_MOVIE : Permission.REQUEST_TV,
      ];
};

/**
 * The server Seerr sends a request of the tier to when none is named: the
 * default one of that tier. Taking the first default sent every request to
 * the standard server, whose default is listed first.
 */
export const defaultServerFor = (
  servers: ServiceCommonServer[] | undefined,
  is4k: boolean,
): ServiceCommonServer | undefined =>
  servers?.find((server) => server.isDefault && server.is4k === is4k);

/** Where a title stands that leaves nothing to ask for. */
const SETTLED = new Set([
  MediaStatus.AVAILABLE,
  MediaStatus.BLOCKLISTED,
  MediaStatus.PENDING,
  MediaStatus.PROCESSING,
]);

/**
 * Whether someone holding `permissions` may ask for `item`, in standard or
 * in 4K: each copy has its own status, requests and permissions on Seerr.
 *
 * The permission depends on the kind of title, read from the title itself.
 * Reading it from `mediaInfo` took every title Seerr had never seen, the ones
 * a request is for, for a series.
 */
export const canRequest = (
  item:
    | MovieResult
    | TvResult
    | MovieDetails
    | TvDetails
    | PersonCreditCast
    | undefined,
  permissions: number,
  { is4k = false }: RequestTier = {},
): boolean => {
  if (!item) return false;

  const media = item.mediaInfo;
  const status = tierStatus(media, is4k);
  const asked = tierRequests(media, is4k).some(
    (r) =>
      r.status === MediaRequestStatus.PENDING ||
      r.status === MediaRequestStatus.APPROVED,
  );
  if (asked || (status !== undefined && SETTLED.has(status))) {
    return false;
  }

  return hasPermission(
    requestPermissions(mediaTypeOf(item), is4k),
    permissions,
    { type: "or" },
  );
};

/**
 * Whether someone holding `permissions` may request for another user.
 *
 * Seerr refuses a request that names its user, even the caller's own id,
 * from anyone without Manage Users and Manage Requests together, and reads
 * another user's quota under the same two. Its own request modal only lists
 * the users for them (AdvancedRequester).
 */
export const canRequestForOthers = (permissions: number): boolean =>
  hasPermission(
    [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
    permissions,
  );

/**
 * Whether a series offers Seerr's "Request more" (RequestButton): Seerr knows
 * it and has not blocklisted it, the user may request series, and a season it
 * could still request is left (TvDetails, isSeasonSetComplete). While Seerr
 * does not know the series, or only knows it as deleted with nothing pending,
 * its plain Request is the one offered, as canRequest has it.
 */
export const canRequestMore = (
  series: TvDetails | undefined,
  permissions: number,
  { specials = false, is4k = false }: { specials?: boolean } & RequestTier = {},
): boolean => {
  const media = series?.mediaInfo;
  // A copy never asked for in 4K can come without a 4K status at all.
  const status =
    tierStatus(media, is4k) ?? (is4k ? MediaStatus.UNKNOWN : undefined);
  if (!series || !media || status === MediaStatus.UNKNOWN) return false;
  if (status === MediaStatus.BLOCKLISTED) return false;
  if (
    status === MediaStatus.DELETED &&
    !tierRequests(media, is4k).some(
      (r) => r.status === MediaRequestStatus.PENDING,
    )
  ) {
    return false;
  }
  if (
    !hasPermission(requestPermissions(MediaType.TV, is4k), permissions, {
      type: "or",
    })
  ) {
    return false;
  }
  return unrequestedSeasons(series, { specials, is4k }).length > 0;
};

/**
 * What a title's page offers, on the phone and the TV alike (RequestButton):
 * Request on a title Seerr does not know, Request more on a series it knows
 * with seasons left to ask for. A season's own request button follows it too.
 * The 4K offer is worked out the same way, from the 4K copy.
 */
export const requestOffer = (
  title:
    | MovieResult
    | TvResult
    | MovieDetails
    | TvDetails
    | PersonCreditCast
    | undefined,
  mediaType: MediaType | undefined,
  permissions: number,
  { specials = false, is4k = false }: { specials?: boolean } & RequestTier = {},
): { canRequest: boolean; requestMore: boolean; offersRequest: boolean } => {
  const asNew = canRequest(title, permissions, { is4k });
  const more =
    mediaType === MediaType.TV &&
    canRequestMore(title as TvDetails, permissions, { specials, is4k });
  return { canRequest: asNew, requestMore: more, offersRequest: asNew || more };
};
