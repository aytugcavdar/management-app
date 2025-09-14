const moment = require('moment');

class DateHelpers {
  static formatDate(date, format = 'YYYY-MM-DD') {
    return moment(date).format(format);
  }
  
  static formatDateTime(date, format = 'YYYY-MM-DD HH:mm:ss') {
    return moment(date).format(format);
  }
  
  static isValidDate(date) {
    return moment(date).isValid();
  }
  
  static addDays(date, days) {
    return moment(date).add(days, 'days').toDate();
  }
  
  static subtractDays(date, days) {
    return moment(date).subtract(days, 'days').toDate();
  }
  
  static getDaysBetween(startDate, endDate) {
    return moment(endDate).diff(moment(startDate), 'days');
  }
  
  static isOverdue(dueDate) {
    return moment(dueDate).isBefore(moment(), 'day');
  }
  
  static isDueSoon(dueDate, days = 3) {
    const today = moment();
    const due = moment(dueDate);
    return due.diff(today, 'days') <= days && due.diff(today, 'days') >= 0;
  }
  
  static getTimeAgo(date) {
    return moment(date).fromNow();
  }
}

module.exports = DateHelpers;