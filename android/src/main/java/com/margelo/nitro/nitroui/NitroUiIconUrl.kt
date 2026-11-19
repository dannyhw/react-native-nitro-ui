package com.margelo.nitro.nitroui

import java.net.URI

/**
 * The URL an `androidIcon` file is actually requested at.
 *
 * In development the URL is Metro's, and Metro writes it from the file's path on disk without
 * escaping it, so a space, a `#` or a `%` sits in it as it is. `URI(url)` refuses such a string
 * and the icon is left blank. The parts are quoted instead: a character that may not appear raw
 * becomes its UTF-8 bytes, and an escape that is already there is kept, so nothing is quoted
 * twice.
 *
 * An icon URL carries no fragment: a `#` in the path is part of the file's name, and only the
 * first `?` starts the query - the reading React Native used when it wrote the URL.
 */
internal object NitroUiIconUrl {
  private const val UNRESERVED = "-._~"
  private const val SUB_DELIMS = "!$&'()*+,;="

  /** What a query may hold beyond `pchar`. A path may hold none of it, so `/` separates there. */
  private const val QUERY_EXTRA = "/?"

  private const val HEX_DIGITS = "0123456789ABCDEF"

  /** [URI] to request [raw] at, with its path and query quoted. Throws on a string that is no URL. */
  fun requestUri(
    raw: String,
  ): URI = URI(quoteUrl(raw))

  /** [raw] with a quoted path and query; the scheme, authority and query separator untouched. */
  fun quoteUrl(
    raw: String,
  ): String {
    val schemeEnd = raw.indexOf("://")
    if (schemeEnd < 0) {
      return raw
    }
    val pathStart = raw.indexOfAny(charArrayOf('/', '?'), schemeEnd + 3)
    if (pathStart < 0) {
      return raw
    }
    // The scheme and authority go over as they stand: brackets around an IPv6 host are legal
    // there, and quoting them would break the host.
    val origin = raw.substring(0, pathStart)
    val rest = raw.substring(pathStart)
    val queryStart = rest.indexOf('?')
    if (queryStart < 0) {
      return origin + quotePath(rest)
    }
    val path = quotePath(rest.substring(0, queryStart))
    val query = quote(rest.substring(queryStart + 1), QUERY_EXTRA)
    return "$origin$path?$query"
  }

  /** Each `/`-separated segment on its own, so a separator is never mistaken for part of a name. */
  private fun quotePath(
    path: String,
  ): String = path.split('/').joinToString("/") { quote(it, "") }

  /** Percent-encodes what [extra] does not allow raw, and keeps an escape that already is one. */
  private fun quote(
    part: String,
    extra: String,
  ): String {
    val out = StringBuilder(part.length + 8)
    var index = 0
    while (index < part.length) {
      val char = part[index]
      if (char == '%' && isEscape(part, index)) {
        out.append(part, index, index + 3)
        index += 3
        continue
      }
      if (isLegal(char, extra)) {
        out.append(char)
        index++
        continue
      }
      // A name outside ASCII travels as its UTF-8 bytes. Half a surrogate pair has none:
      // `toByteArray` answers with `?`, which goes over as `%3F`.
      val isPair =
        char.isHighSurrogate() && index + 1 < part.length && part[index + 1].isLowSurrogate()
      val width = if (isPair) 2 else 1
      for (byte in part.substring(index, index + width).toByteArray(Charsets.UTF_8)) {
        val octet = byte.toInt() and 0xFF
        out.append('%').append(HEX_DIGITS[octet shr 4]).append(HEX_DIGITS[octet and 0x0F])
      }
      index += width
    }
    return out.toString()
  }

  private fun isEscape(
    part: String,
    at: Int,
  ): Boolean = at + 2 < part.length && hexValue(part[at + 1]) >= 0 && hexValue(part[at + 2]) >= 0

  private fun hexValue(
    char: Char,
  ): Int = HEX_DIGITS.indexOf(char.uppercaseChar())

  // ASCII only on purpose: `Char.isLetterOrDigit` is Unicode-aware, which would let a non-ASCII
  // letter through raw and break the request line it is sent in.
  private fun isLegal(
    char: Char,
    extra: String,
  ): Boolean =
    char in 'a'..'z' ||
      char in 'A'..'Z' ||
      char in '0'..'9' ||
      UNRESERVED.indexOf(char) >= 0 ||
      SUB_DELIMS.indexOf(char) >= 0 ||
      char == ':' ||
      char == '@' ||
      extra.indexOf(char) >= 0
}
