class StringHelpers {
  static generateSlug(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9 -]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim('-');
  }
  
  static generateId(prefix = '') {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2);
    return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
  }
  
  static truncate(text, maxLength = 100, suffix = '...') {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - suffix.length) + suffix;
  }
  
  static capitalizeFirst(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  
  static capitalizeWords(text) {
    return text.replace(/\w\S*/g, (txt) => 
      txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );
  }
  
  static removeSpecialChars(text) {
    return text.replace(/[^a-zA-Z0-9\s]/g, '');
  }
  
  static isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}

module.exports = StringHelpers;