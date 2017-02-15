function sentenceCase (s = '') {
  // Matches the first letter in the string and the first letter that follows a
  // period (and 1 or more spaces) and transforms that letter to uppercase.
  return s.replace(/(^[a-z])|(\.\s*[a-z])/g, function (s) { return s.toUpperCase() })
}

function titleCase (str) {
  return str.toLowerCase().split(' ').map(function (word) {
    return capitalize(word)
  }).join(' ')
}

function capitalize (str) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

function t (s = '') {
  return sentenceCase(s.replace(/_/g, ' '))
}

module.exports = {
  sentenceCase,
  titleCase,
  capitalize,
  t
}
