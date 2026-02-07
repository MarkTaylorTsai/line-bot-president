require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const { createClient } = require('@supabase/supabase-js');
const moment = require('moment-timezone');


const app = express();

// LINE Bot configuration
const lineConfig = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// President (會長) configuration - who receives the reminders
const PRESIDENT_LINE_USER_ID = process.env.PRESIDENT_LINE_USER_ID;

const client = new line.Client(lineConfig);

// Track LINE users (follow) and groups (join) for reminder recipients
class ContactTracker {
  static async recordUser(userId) {
    if (!userId) return { success: false };
    try {
      const { error } = await supabase
        .from('line_users')
        .upsert(
          { user_id: userId, active: true, updated_at: new Date().toISOString() },
          { onConflict: 'user_id', ignoreDuplicates: false }
        );
      if (error) throw error;
      console.log('📌 Recorded user (follow):', userId);
      return { success: true };
    } catch (e) {
      console.error('Error recording user:', e);
      return { success: false, error: e.message };
    }
  }

  static async recordGroup(groupId) {
    if (!groupId) return { success: false };
    try {
      const { error } = await supabase
        .from('line_groups')
        .upsert(
          { group_id: groupId, active: true, updated_at: new Date().toISOString() },
          { onConflict: 'group_id', ignoreDuplicates: false }
        );
      if (error) throw error;
      console.log('📌 Recorded group (join):', groupId);
      return { success: true };
    } catch (e) {
      console.error('Error recording group:', e);
      return { success: false, error: e.message };
    }
  }

  static async setUserInactive(userId) {
    if (!userId) return { success: false };
    try {
      const { error } = await supabase
        .from('line_users')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      if (error) throw error;
      console.log('📌 User unfollowed (inactive):', userId);
      return { success: true };
    } catch (e) {
      console.error('Error setting user inactive:', e);
      return { success: false, error: e.message };
    }
  }

  static async setGroupInactive(groupId) {
    if (!groupId) return { success: false };
    try {
      const { error } = await supabase
        .from('line_groups')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('group_id', groupId);
      if (error) throw error;
      console.log('📌 Bot left group (inactive):', groupId);
      return { success: true };
    } catch (e) {
      console.error('Error setting group inactive:', e);
      return { success: false, error: e.message };
    }
  }
}

// Middleware
// Note: express.json() is not needed for LINE webhook as it needs raw body for signature validation

// Interview management functions
class InterviewManager {
  // Add new interview
  static async addInterview(userId, intervieweeName, interviewerName, date, time, reason) {
    try {
      const { data, error } = await supabase
        .from('interviews')
        .insert([
          {
            user_id: userId,
            interviewee_name: intervieweeName,
            interviewer_name: interviewerName,
            interview_date: date,
            interview_time: time,
            reason: reason
          }
        ])
        .select();

      if (error) throw error;

      // Check if this interview needs immediate reminders (edge case handling)
      const interview = data[0];
      const interviewDateTime = moment.tz(`${interview.interview_date} ${interview.interview_time}`, 'YYYY-MM-DD HH:mm:ss', 'Asia/Taipei');
      const now = moment.tz('Asia/Taipei');
      const diffHours = interviewDateTime.diff(now, 'hours', true);

      // If interview is less than 3 hours away, mark 24h reminder as sent
      if (diffHours < 3) {
        await this.markReminderSent(interview.id, '24h');
        console.log(`⚠️ Interview ${interview.id} added less than 3 hours before start - 24h reminder skipped`);
      }

      // If interview is less than 1 hour away, mark 3h reminder as sent
      if (diffHours < 1) {
        await this.markReminderSent(interview.id, '3h');
        console.log(`⚠️ Interview ${interview.id} added less than 1 hour before start - 3h reminder skipped`);
      }

      return { success: true, data: interview };
    } catch (error) {
      console.error('Error adding interview:', error);
      return { success: false, error: error.message };
    }
  }

  // Get all interviews for a user
  static async getInterviews(userId) {
    try {
      const { data, error } = await supabase
        .from('interviews')
        .select('*')
        .eq('user_id', userId)
        .order('interview_date', { ascending: true })
        .order('interview_time', { ascending: true });

      if (error) throw error;
      return { success: true, data };
    } catch (error) {
      console.error('Error getting interviews:', error);
      return { success: false, error: error.message };
    }
  }

  // Get all upcoming interviews (from today onwards) for broadcast
  static async getAllUpcomingInterviews() {
    try {
      const today = moment.tz('Asia/Taipei').format('YYYY-MM-DD');
      const { data, error } = await supabase
        .from('interviews')
        .select('*')
        .gte('interview_date', today)
        .order('interview_date', { ascending: true })
        .order('interview_time', { ascending: true });

      if (error) throw error;
      return { success: true, data: data || [] };
    } catch (error) {
      console.error('Error getting all upcoming interviews:', error);
      return { success: false, error: error.message, data: [] };
    }
  }

  // Update interview
  static async updateInterview(userId, interviewId, updates) {
    try {
      const { data, error } = await supabase
        .from('interviews')
        .update(updates)
        .eq('id', interviewId)
        .eq('user_id', userId)
        .select();

      if (error) throw error;
      return { success: true, data: data[0] };
    } catch (error) {
      console.error('Error updating interview:', error);
      return { success: false, error: error.message };
    }
  }

  // Delete interview
  static async deleteInterview(userId, interviewId) {
    try {
      const { error } = await supabase
        .from('interviews')
        .delete()
        .eq('id', interviewId)
        .eq('user_id', userId);

      if (error) throw error;
      return { success: true };
    } catch (error) {
      console.error('Error deleting interview:', error);
      return { success: false, error: error.message };
    }
  }

  // Get interviews that need reminders
  static async getInterviewsNeedingReminders() {
    try {
      const now = moment.tz('Asia/Taipei');
      
      // Get all interviews that haven't sent reminders yet
      const { data: allInterviews, error } = await supabase
        .from('interviews')
        .select('*')
        .or('reminder_24h_sent.eq.false,reminder_3h_sent.eq.false')
        .gte('interview_date', now.format('YYYY-MM-DD'));

      if (error) throw error;

      // Diagnostic log: Did Supabase return interviews?
      console.log('Fetched interviews:', allInterviews ? allInterviews.length : 0);

      const interviews24h = [];
      const interviews3h = [];

      // Process each interview to check exact timing
      for (const interview of allInterviews || []) {
        const interviewDateTime = moment.tz(`${interview.interview_date} ${interview.interview_time}`, 'YYYY-MM-DD HH:mm:ss', 'Asia/Taipei');
        const diffHours = interviewDateTime.diff(now, 'hours', true);

        // Check for 24-hour reminder (between 23.5 and 24.5 hours before)
        if (!interview.reminder_24h_sent && diffHours >= 23.5 && diffHours <= 24.5) {
          interviews24h.push(interview);
        }

        // Check for 3-hour reminder (between 2.5 and 3.5 hours before)
        if (!interview.reminder_3h_sent && diffHours >= 2.5 && diffHours <= 3.5) {
          interviews3h.push(interview);
        }
      }

      // Diagnostic log: Did any match the 24h condition?
      console.log('24h matches:', interviews24h.length, '3h matches:', interviews3h.length);

      return {
        success: true,
        data: {
          interviews24h,
          interviews3h
        }
      };
    } catch (error) {
      console.error('Error getting interviews needing reminders:', error);
      return { success: false, error: error.message };
    }
  }

  // Mark reminder as sent
  static async markReminderSent(interviewId, reminderType) {
    try {
      const updateData = {};
      if (reminderType === '24h') {
        updateData.reminder_24h_sent = true;
      } else if (reminderType === '3h') {
        updateData.reminder_3h_sent = true;
      }

      const { error } = await supabase
        .from('interviews')
        .update(updateData)
        .eq('id', interviewId);

      if (error) throw error;
      return { success: true };
    } catch (error) {
      console.error('Error marking reminder sent:', error);
      return { success: false, error: error.message };
    }
  }
}

// Field mapping for Chinese field names to database columns
const fieldMap = {
  '面談對象': 'interviewee_name',
  '面談者': 'interviewer_name',
  '日期': 'interview_date',
  '時間': 'interview_time',
  '理由': 'reason'
};

// Input validation and sanitization
class InputValidator {
  static sanitizeString(input) {
    if (!input || typeof input !== 'string') return '';
    return input.trim().replace(/[<>]/g, ''); // Basic XSS prevention
  }
  
  static validateDate(dateString) {
    return moment.tz(dateString, 'YYYY-MM-DD', true, 'Asia/Taipei').isValid();
  }
  
  static validateTime(timeString) {
    return moment.tz(timeString, ['HH:mm', 'HH:mm:ss'], true, 'Asia/Taipei').isValid();
  }
  
  static validateName(name) {
    const sanitized = this.sanitizeString(name);
    return sanitized.length > 0 && sanitized.length <= 100;
  }
}

// Message parsing functions
class MessageParser {
  // Parse "新增" command - 新增 {面談對象} {面談者} {日期} {時間} {理由}
  static parseAddCommand(text) {
    // Allow both : and ： (full-width colon)
    const regex = /新增\s+([^\s]+)\s+([^\s]+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}[:：]\d{2})\s+(.+)/;
    const match = text.match(regex);
    
    if (!match) return null;
    
    // Normalize full-width colon to standard colon
    const time = match[4].replace('：', ':');
    
    return {
      intervieweeName: match[1],
      interviewerName: match[2],
      date: match[3],
      time: time + ':00', // Add seconds for proper TIME format
      reason: match[5]
    };
  }

  // Parse update command (format: 更新 {id} {field} {value})
  static parseUpdateCommand(text) {
    const regex = /更新\s+(\d+)\s+([^\s]+)\s+(.+)/;
    const match = text.match(regex);
    
    if (!match) return null;
    
    return {
      id: parseInt(match[1]),
      field: match[2],
      value: match[3]
    };
  }

  // Parse delete command (format: 刪除 {id})
  static parseDeleteCommand(text) {
    const regex = /刪除\s+(\d+)/;
    const match = text.match(regex);
    
    if (!match) return null;
    
    return {
      id: parseInt(match[1])
    };
  }
}

// Message handling
async function handleMessage(event) {
  const { text } = event.message;
  const userId = event.source.userId;

  try {
    // Handle different commands
    if (text === '查看 全部' || text === '查看全部') {
      await handleListCommand(userId, event.replyToken);
    } else if (text.startsWith('新增')) {
      await handleAddCommand(text, userId, event.replyToken);
    } else if (text.startsWith('更新')) {
      await handleUpdateCommand(text, userId, event.replyToken);
    } else if (text.startsWith('刪除')) {
      await handleDeleteCommand(text, userId, event.replyToken);
    } else if (text === '提醒狀態') {
      await handleReminderStatusCommand(userId, event.replyToken);
    }
    // Note: No else clause - unrecognized commands are handled in webhook
  } catch (error) {
    console.error('Error handling message:', error);
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '抱歉，處理您的訊息時發生錯誤。請稍後再試。'
    });
  }
}

// Command handlers
async function handleListCommand(userId, replyToken) {
  const result = await InterviewManager.getInterviews(userId);
  
  if (!result.success) {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '獲取清單時發生錯誤。'
    });
    return;
  }

  if (result.data.length === 0) {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '目前沒有安排的面談。'
    });
    return;
  }

  let message = '📋 全部面談：\n\n';
  result.data.forEach((interview, index) => {
    const date = moment.tz(interview.interview_date, 'Asia/Taipei').format('YYYY-MM-DD');
    // Format time to show only HH:mm for display
    const time = interview.interview_time ? interview.interview_time.substring(0, 5) : interview.interview_time;
    message += `${index + 1}. ID: ${interview.id}\n`;
    message += `   面談對象: ${interview.interviewee_name}\n`;
    message += `   面談者: ${interview.interviewer_name || '未指定'}\n`;
    message += `   日期: ${date}\n`;
    message += `   時間: ${time}\n`;
    message += `   理由: ${interview.reason || '無'}\n\n`;
  });

  await client.replyMessage(replyToken, {
    type: 'text',
    text: message
  });
}

async function handleAddCommand(text, userId, replyToken) {
  const parsed = MessageParser.parseAddCommand(text);
  
  if (!parsed) {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '格式錯誤！請使用：新增 {面談對象} {面談者} {日期} {時間} {理由}\n例如：新增 約翰 陳佑庭 2024-01-15 14:30 聖殿推薦書面談'
    });
    return;
  }

  // Validate and sanitize inputs
  if (!InputValidator.validateName(parsed.intervieweeName)) {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '面談對象姓名無效！請輸入有效的姓名。'
    });
    return;
  }

  if (!InputValidator.validateName(parsed.interviewerName)) {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '面談者姓名無效！請輸入有效的姓名。'
    });
    return;
  }

  if (!InputValidator.validateDate(parsed.date)) {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '日期格式錯誤！請使用 YYYY-MM-DD 格式。'
    });
    return;
  }

  if (!InputValidator.validateTime(parsed.time)) {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '時間格式錯誤！請使用 HH:mm 格式。'
    });
    return;
  }

  // Sanitize inputs
  const sanitizedData = {
    intervieweeName: InputValidator.sanitizeString(parsed.intervieweeName),
    interviewerName: InputValidator.sanitizeString(parsed.interviewerName),
    date: parsed.date,
    time: parsed.time,
    reason: InputValidator.sanitizeString(parsed.reason)
  };

  const result = await InterviewManager.addInterview(
    userId,
    sanitizedData.intervieweeName,
    sanitizedData.interviewerName,
    sanitizedData.date,
    sanitizedData.time,
    sanitizedData.reason
  );

  if (result.success) {
    // Format time to show only HH:mm for display
    const displayTime = parsed.time.substring(0, 5);
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '✅ 面談已成功新增！\n\n面談對象: ' + sanitizedData.intervieweeName + '\n面談者: ' + sanitizedData.interviewerName + '\n日期: ' + sanitizedData.date + '\n時間: ' + displayTime + '\n理由: ' + sanitizedData.reason + '\n\nID: ' + result.data.id
    });
  } else {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '新增面談時發生錯誤。'
    });
  }
}

async function handleUpdateCommand(text, userId, replyToken) {
  const parsed = MessageParser.parseUpdateCommand(text);
  
  if (!parsed) {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '格式錯誤！請使用：更新 {ID} {欄位} {新值}\n例如：更新 1 面談對象 約翰'
    });
    return;
  }

  // Map Chinese field name to database column
  const dbField = fieldMap[parsed.field];
  if (!dbField) {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '無效的欄位！可用欄位：面談對象、面談者、日期、時間、理由'
    });
    return;
  }

  const updates = {};
  let valueToStore = parsed.value;

  // Handle time formatting for database storage
  if (dbField === 'interview_time') {
    // Replace full-width colon with standard colon
    valueToStore = parsed.value.replace('：', ':');
    // Add seconds if not provided
    if (valueToStore.match(/^\d{2}:\d{2}$/)) {
      valueToStore += ':00';
    }
  }

  updates[dbField] = valueToStore;

  // Validate date/time if updating those fields
  if (dbField === 'interview_date' && !moment.tz(parsed.value, 'YYYY-MM-DD', true, 'Asia/Taipei').isValid()) {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '日期格式錯誤！請使用 YYYY-MM-DD 格式。'
    });
    return;
  }

  if (dbField === 'interview_time' && 
      !moment.tz(valueToStore, ['HH:mm', 'HH:mm:ss'], true, 'Asia/Taipei').isValid()) {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '時間格式錯誤！請使用 HH:mm 格式。'
    });
    return;
  }

  const result = await InterviewManager.updateInterview(userId, parsed.id, updates);

  if (result.success) {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '✅ 面談已成功更新！\n\nID: ' + parsed.id + '\n' + parsed.field + ': ' + parsed.value
    });
  } else {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '更新面談時發生錯誤。請確認 ID 是否正確。'
    });
  }
}

async function handleDeleteCommand(text, userId, replyToken) {
  const parsed = MessageParser.parseDeleteCommand(text);
  
  if (!parsed) {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '格式錯誤！請使用：刪除 {ID}\n例如：刪除 1'
    });
    return;
  }

  const result = await InterviewManager.deleteInterview(userId, parsed.id);

  if (result.success) {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '✅ 面談 ID ' + parsed.id + ' 已成功刪除！'
    });
  } else {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '刪除面談時發生錯誤。請確認 ID 是否正確。'
    });
  }
}

async function handleReminderStatusCommand(userId, replyToken) {
  const result = await InterviewManager.getInterviews(userId);
  
  if (!result.success) {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '獲取清單時發生錯誤。'
    });
    return;
  }

  if (result.data.length === 0) {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: '目前沒有安排的面談。'
    });
    return;
  }

  let message = '📋 面談提醒狀態：\n\n';
  result.data.forEach((interview, index) => {
    const date = moment.tz(interview.interview_date, 'Asia/Taipei').format('YYYY-MM-DD');
    const time = interview.interview_time ? interview.interview_time.substring(0, 5) : interview.interview_time;
    const interviewDateTime = moment.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', 'Asia/Taipei');
    const now = moment.tz('Asia/Taipei');
    const hoursUntil = interviewDateTime.diff(now, 'hours', true);
    
    message += `${index + 1}. ID: ${interview.id}\n`;
    message += '   面談對象: ' + interview.interviewee_name + '\n';
    message += '   面談者: ' + (interview.interviewer_name || '未指定') + '\n';
    message += '   日期: ' + date + '\n';
    message += '   時間: ' + time + '\n';
    message += '   理由: ' + (interview.reason || '無') + '\n';
    message += '   24小時提醒: ' + (interview.reminder_24h_sent ? '✅ 已發送' : '❌ 未發送') + '\n';
    message += '   3小時提醒: ' + (interview.reminder_3h_sent ? '✅ 已發送' : '❌ 未發送') + '\n';
    message += '   距離現在: ' + (hoursUntil > 0 ? hoursUntil.toFixed(1) + '小時' : '已過期') + '\n\n';
  });

  await client.replyMessage(replyToken, {
    type: 'text',
    text: message
  });
}

async function sendHelpMessage(replyToken) {
  const helpText = '會長團助理使用說明：\n\n📝 新增面談：\n新增 {面談對象} {面談者} {日期} {時間} {理由}\n例如：新增 約翰 陳佑庭 2024-01-15 14:30 聖殿推薦書面談\n\n📋 查看全部：\n查看 全部\n\n✏️ 更新面談：\n更新 {ID} {欄位} {新值}\n例如：更新 1 面談對象 彼得\n可用欄位：面談對象、面談者、日期、時間、理由\n\n🗑️ 刪除面談：\n刪除 {ID}\n例如：刪除 1\n\n📋 查看提醒狀態：\n提醒狀態\n\n💡 注意事項：\n- 日期格式：YYYY-MM-DD\n- 時間格式：HH:mm\n- ID 可在「查看 全部」清單中查看\n- 系統會自動發送24小時和3小時前的提醒通知';

  await client.replyMessage(replyToken, {
    type: 'text',
    text: helpText
  });
}

// Reminder notification functions
class ReminderManager {
  // Validate LINE user ID format
  static isValidLineUserId(userId) {
    // LINE user IDs should start with 'U' and be 33 characters long
    return userId && typeof userId === 'string' && userId.startsWith('U') && userId.length === 33;
  }

  // Validate LINE group ID format
  static isValidLineGroupId(groupId) {
    // LINE group IDs should start with 'C' and be 33 characters long
    return groupId && typeof groupId === 'string' && groupId.startsWith('C') && groupId.length === 33;
  }

  // Validate LINE room ID format
  static isValidLineRoomId(roomId) {
    // LINE room IDs should start with 'R' and be 33 characters long
    return roomId && typeof roomId === 'string' && roomId.startsWith('R') && roomId.length === 33;
  }

  // Get all user IDs and group IDs to send reminders to (tracked users/groups + env fallback)
  static async getReminderRecipientIds() {
    const userIds = new Set();
    const groupIds = new Set();

    // Tracked users: everyone who has added the bot as a friend (follow event)
    try {
      const { data: users, error: uErr } = await supabase
        .from('line_users')
        .select('user_id')
        .eq('active', true);
      if (!uErr && users) {
        users.forEach(row => { if (row.user_id) userIds.add(row.user_id); });
      }
    } catch (e) {
      console.error('Error fetching line_users for reminders:', e);
    }

    // Fallback: distinct users from interviews if no tracked users yet (e.g. before migration)
    if (userIds.size === 0) {
      try {
        const { data: rows, error } = await supabase
          .from('interviews')
          .select('user_id');
        if (!error && rows) {
          for (const row of rows) {
            if (row.user_id) userIds.add(row.user_id);
          }
        }
      } catch (e) {
        console.error('Error fetching distinct user_ids for reminders:', e);
      }
    }

    // Add president if configured
    if (PRESIDENT_LINE_USER_ID) userIds.add(PRESIDENT_LINE_USER_ID);

    // Tracked groups: every group the bot has joined (join event)
    try {
      const { data: groups, error: gErr } = await supabase
        .from('line_groups')
        .select('group_id')
        .eq('active', true);
      if (!gErr && groups) {
        groups.forEach(row => { if (row.group_id) groupIds.add(row.group_id); });
      }
    } catch (e) {
      console.error('Error fetching line_groups for reminders:', e);
    }

    // Fallback: env group IDs if no tracked groups yet
    if (groupIds.size === 0) {
      const singleGroup = (process.env.GROUP_ID || '').trim();
      if (singleGroup) groupIds.add(singleGroup);
      const multipleGroups = (process.env.GROUP_IDS || '').trim();
      if (multipleGroups) {
        multipleGroups.split(',').map(s => s.trim()).filter(Boolean).forEach(id => groupIds.add(id));
      }
    } else {
      // Also add env groups so both tracked and configured groups receive reminders
      const singleGroup = (process.env.GROUP_ID || '').trim();
      if (singleGroup) groupIds.add(singleGroup);
      const multipleGroups = (process.env.GROUP_IDS || '').trim();
      if (multipleGroups) {
        multipleGroups.split(',').map(s => s.trim()).filter(Boolean).forEach(id => groupIds.add(id));
      }
    }

    return {
      userIds: [...userIds],
      groupIds: [...groupIds]
    };
  }

  // Send reminder message to every user and every group
  static async sendReminderMessage(interview, reminderType) {
    try {
      const date = moment.tz(interview.interview_date, 'Asia/Taipei').format('YYYY-MM-DD');
      const time = interview.interview_time ? interview.interview_time.substring(0, 5) : interview.interview_time;
      const hoursText = reminderType === '24h' ? '24小時' : '3小時';
      
      const message = '🔔 面談提醒通知\n\n您有一個面談即將在' + hoursText + '後舉行：\n\n👤 面談對象：' + interview.interviewee_name + '\n👨‍💼 面談者：' + (interview.interviewer_name || '未指定') + '\n📅 日期：' + date + '\n⏰ 時間：' + time + '\n📝 理由：' + (interview.reason || '無') + '\n\n請做好準備！';

      let sentCount = 0;
      const errors = [];

      const { userIds, groupIds } = await this.getReminderRecipientIds();

      // Send to every user (all distinct users from interviews + president)
      for (const userId of userIds) {
        if (!this.isValidLineUserId(userId)) {
          console.warn(`⚠️ Skipping user ${userId} - not a valid LINE user ID format`);
          errors.push(`User ${userId}: Invalid LINE user ID format`);
          continue;
        }
        try {
          await client.pushMessage(userId, {
            type: 'text',
            text: message
          });
          sentCount++;
          console.log(`📨 Sent ${reminderType} reminder to user ${userId} for interview ${interview.id}`);
        } catch (error) {
          console.error(`❌ Failed to send reminder to user ${userId}:`, error);
          if (error.originalError && error.originalError.response) {
            console.error('LINE API error details:', error.originalError.response.data);
          }
          errors.push(`User ${userId}: ${error.message}`);
        }
      }

      // Send to every group
      for (const groupId of groupIds) {
        if (!this.isValidLineGroupId(groupId)) {
          console.warn(`⚠️ Skipping group ${groupId} - not a valid LINE group ID format`);
          errors.push(`Group ${groupId}: Invalid LINE group ID format`);
          continue;
        }
        try {
          await client.pushMessage(groupId, {
            type: 'text',
            text: message
          });
          sentCount++;
          console.log(`📨 Sent ${reminderType} reminder to group ${groupId} for interview ${interview.id}`);
        } catch (error) {
          console.error(`❌ Failed to send reminder to group ${groupId}:`, error);
          if (error.originalError && error.originalError.response) {
            console.error('LINE API error details:', error.originalError.response.data);
          }
          errors.push(`Group ${groupId}: ${error.message}`);
        }
      }

      return { 
        success: sentCount > 0, 
        sentCount,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      console.error('Error sending reminder message:', error);
      return { success: false, error: error.message };
    }
  }

  // Send the full interview list to every user and every group (for cron "list reminder")
  static async sendInterviewListToEveryone() {
    const result = await InterviewManager.getAllUpcomingInterviews();
    if (!result.success) {
      return { success: false, error: result.error, sentCount: 0 };
    }
    const interviews = result.data || [];
    let message = '📋 全部面談提醒\n\n';
    if (interviews.length === 0) {
      message += '目前沒有即將舉行的面談。\n';
    } else {
      const maxLen = 4500;
      for (let i = 0; i < interviews.length; i++) {
        const interview = interviews[i];
        const date = moment.tz(interview.interview_date, 'Asia/Taipei').format('YYYY-MM-DD');
        const time = interview.interview_time ? String(interview.interview_time).substring(0, 5) : (interview.interview_time || '');
        const block = `${i + 1}. ID: ${interview.id}\n   面談對象: ${interview.interviewee_name}\n   面談者: ${interview.interviewer_name || '未指定'}\n   日期: ${date}\n   時間: ${time}\n   理由: ${interview.reason || '無'}\n\n`;
        if (message.length + block.length > maxLen) {
          message += `…共 ${interviews.length} 筆面談，僅顯示部分。\n`;
          break;
        }
        message += block;
      }
    }
    message += '\n輸入「查看 全部」可查看完整清單。';

    const { userIds, groupIds } = await this.getReminderRecipientIds();
    let sentCount = 0;
    const errors = [];

    for (const userId of userIds) {
      if (!this.isValidLineUserId(userId)) continue;
      try {
        await client.pushMessage(userId, { type: 'text', text: message });
        sentCount++;
      } catch (error) {
        console.error(`Failed to send interview list to user ${userId}:`, error);
        errors.push(`User ${userId}: ${error.message}`);
      }
    }
    for (const groupId of groupIds) {
      if (!this.isValidLineGroupId(groupId)) continue;
      try {
        await client.pushMessage(groupId, { type: 'text', text: message });
        sentCount++;
      } catch (error) {
        console.error(`Failed to send interview list to group ${groupId}:`, error);
        errors.push(`Group ${groupId}: ${error.message}`);
      }
    }

    return {
      success: true,
      sentCount,
      interviewCount: interviews.length,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  // Process reminders
  static async processReminders() {
    try {
      console.log('🕐 Processing reminders...');
      
      const result = await InterviewManager.getInterviewsNeedingReminders();
      
      if (!result.success) {
        console.error('Failed to get interviews needing reminders:', result.error);
        return { success: false, error: result.error };
      }

      const { interviews24h, interviews3h } = result.data;
      let totalSent = 0;
      let errors = [];

      console.log(`📋 Found ${interviews24h.length} interviews needing 24h reminders`);
      console.log(`📋 Found ${interviews3h.length} interviews needing 3h reminders`);

      // Process 24-hour reminders
      for (const interview of interviews24h) {
        try {
          console.log(`🔄 Processing 24h reminder for interview ${interview.id}: ${interview.interviewee_name} on ${interview.interview_date} at ${interview.interview_time}`);
          const reminderResult = await this.sendReminderMessage(interview, '24h');
          if (reminderResult.success) {
            await InterviewManager.markReminderSent(interview.id, '24h');
            totalSent += reminderResult.sentCount || 1;
            console.log(`✅ Sent 24h reminder for interview ${interview.id} to ${reminderResult.sentCount} recipients`);
            if (reminderResult.errors) {
              errors.push(...reminderResult.errors);
            }
          } else {
            console.error(`❌ Failed to send 24h reminder for interview ${interview.id}:`, reminderResult.error);
            errors.push(`24h reminder for interview ${interview.id}: ${reminderResult.error}`);
          }
        } catch (error) {
          console.error(`❌ Error processing 24h reminder for interview ${interview.id}:`, error);
          errors.push(`24h reminder for interview ${interview.id}: ${error.message}`);
        }
      }

      // Process 3-hour reminders
      for (const interview of interviews3h) {
        try {
          console.log(`🔄 Processing 3h reminder for interview ${interview.id}: ${interview.interviewee_name} on ${interview.interview_date} at ${interview.interview_time}`);
          const reminderResult = await this.sendReminderMessage(interview, '3h');
          if (reminderResult.success) {
            await InterviewManager.markReminderSent(interview.id, '3h');
            totalSent += reminderResult.sentCount || 1;
            console.log(`✅ Sent 3h reminder for interview ${interview.id} to ${reminderResult.sentCount} recipients`);
            if (reminderResult.errors) {
              errors.push(...reminderResult.errors);
            }
          } else {
            console.error(`❌ Failed to send 3h reminder for interview ${interview.id}:`, reminderResult.error);
            errors.push(`3h reminder for interview ${interview.id}: ${reminderResult.error}`);
          }
        } catch (error) {
          console.error(`❌ Error processing 3h reminder for interview ${interview.id}:`, error);
          errors.push(`3h reminder for interview ${interview.id}: ${error.message}`);
        }
      }

      if (totalSent > 0) {
        console.log(`📨 Total reminders sent: ${totalSent}`);
      } else {
        console.log('📭 No reminders to send');
      }

      return {
        success: true,
        totalSent,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      console.error('Error processing reminders:', error);
      return { success: false, error: error.message };
    }
  }
}

// Webhook endpoint
app.post('/callback', line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events;

    // Process each event
    await Promise.all(events.map(async (event) => {
      // Log source information to help identify group/room IDs
      console.log('Event Source:', event.source);
      
      if (event.source.type === 'group') {
        console.log('Group ID:', event.source.groupId);
      }
      if (event.source.type === 'room') {
        console.log('Room ID:', event.source.roomId);
      }
      if (event.source.type === 'user') {
        console.log('User ID:', event.source.userId);
      }

      if (event.type === 'message' && event.message.type === 'text') {
        const userMessage = event.message.text;

        const isHelp = (msg) => (msg && (msg.trim().toLowerCase() === 'help' || msg.trim() === '幫助'));
        if (isHelp(userMessage)) {
          const instructionMenu = {
            type: 'text',
            text: '會長團助理使用說明：\n\n📝 新增面談：\n新增 {面談對象} {面談者} {日期} {時間} {理由}\n例如：新增 約翰 陳佑庭 2024-01-15 14:30 聖殿推薦書面談\n\n📋 查看全部：\n查看 全部\n\n✏️ 更新面談：\n更新 {ID} {欄位} {新值}\n例如：更新 1 面談對象 彼得\n可用欄位：面談對象、面談者、日期、時間、理由\n\n🗑️ 刪除面談：\n刪除 {ID}\n例如：刪除 1\n\n📋 查看提醒狀態：\n提醒狀態\n\n💡 注意事項：\n- 日期格式：YYYY-MM-DD\n- 時間格式：HH:mm\n- ID 可在「查看 全部」清單中查看\n- 系統會自動發送24小時和3小時前的提醒通知'
          };
          return client.replyMessage(event.replyToken, instructionMenu);
        }

        // Handle CRUD commands
if (userMessage === '查看 全部' || userMessage === '查看全部' ||
            userMessage.startsWith('新增') ||
            userMessage.startsWith('更新') || 
            userMessage.startsWith('刪除') || 
            userMessage === '提醒狀態') {
          return handleMessage(event);
        }

        // If the message is not recognized, do nothing
        return Promise.resolve(null);
      } else if (event.type === 'follow') {
        const userId = event.source.type === 'user' ? event.source.userId : null;
        if (userId) ContactTracker.recordUser(userId);
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '👋 歡迎使用面談助理！輸入「help」或「幫助」查看功能選單，或直接使用以下指令：\n\n• 新增 {面談對象} {面談者} {日期} {時間} {理由}\n• 查看 全部\n• 更新 {ID} {欄位} {新值}\n• 刪除 {ID}'
        });
      } else if (event.type === 'unfollow') {
        const userId = event.source.type === 'user' ? event.source.userId : null;
        if (userId) ContactTracker.setUserInactive(userId);
        return Promise.resolve(null);
      } else if (event.type === 'join') {
        const groupId = event.source.type === 'group' ? event.source.groupId : null;
        if (groupId) ContactTracker.recordGroup(groupId);
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '👋 您好！我是面談助理！請輸入「help」或「幫助」查看功能選單。'
        });
      } else if (event.type === 'leave') {
        const groupId = event.source.type === 'group' ? event.source.groupId : null;
        if (groupId) ContactTracker.setGroupInactive(groupId);
        return Promise.resolve(null);
      } else {
        // Ignore other events
        return Promise.resolve(null);
      }
    }));

    res.status(200).end();
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).end();
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'LINE Interview Bot is running!' });
});

// Debug endpoint to check interviews and reminder status
app.get('/debug-reminders', async (req, res) => {
  try {
    const result = await InterviewManager.getInterviewsNeedingReminders();
    
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    const { interviews24h, interviews3h } = result.data;
    const now = moment.tz('Asia/Taipei');
    
    // Get all interviews for debugging
    const allInterviewsResult = await InterviewManager.getInterviews('debug');
    
    res.json({
      success: true,
      currentTime: now.format('YYYY-MM-DD HH:mm:ss'),
      timezone: 'Asia/Taipei',
      interviewsNeeding24hReminders: interviews24h.length,
      interviewsNeeding3hReminders: interviews3h.length,
      interviews24h: interviews24h.map(i => ({
        id: i.id,
        name: i.interviewee_name,
        date: i.interview_date,
        time: i.interview_time,
        user_id: i.user_id,
        user_id_valid: ReminderManager.isValidLineUserId(i.user_id),
        reminder_24h_sent: i.reminder_24h_sent,
        reminder_3h_sent: i.reminder_3h_sent
      })),
      interviews3h: interviews3h.map(i => ({
        id: i.id,
        name: i.interviewee_name,
        date: i.interview_date,
        time: i.interview_time,
        user_id: i.user_id,
        user_id_valid: ReminderManager.isValidLineUserId(i.user_id),
        reminder_24h_sent: i.reminder_24h_sent,
        reminder_3h_sent: i.reminder_3h_sent
      })),
      totalInterviewsInDB: allInterviewsResult.success ? allInterviewsResult.data.length : 'Error fetching',
      presidentConfig: {
        president_user_id: PRESIDENT_LINE_USER_ID,
        president_user_id_valid: ReminderManager.isValidLineUserId(PRESIDENT_LINE_USER_ID)
      },
      groupConfig: {
        group_id: process.env.GROUP_ID,
        group_ids: (process.env.GROUP_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
        group_id_valid: ReminderManager.isValidLineGroupId(process.env.GROUP_ID)
      },
      reminderRecipients: await ReminderManager.getReminderRecipientIds(),
      trackedContacts: {
        line_users: await supabase.from('line_users').select('user_id, active, created_at').then(({ data, error }) => error ? { error: error.message } : data),
        line_groups: await supabase.from('line_groups').select('group_id, active, created_at').then(({ data, error }) => error ? { error: error.message } : data)
      }
    });
  } catch (error) {
    console.error('Debug endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test endpoint to create a sample interview for testing reminders
app.post('/create-test-interview', async (req, res) => {
  try {
    const now = moment.tz('Asia/Taipei');
    
    // Create an interview exactly 3 hours from now (for 3h reminder testing)
    const testTime = now.clone().add(3, 'hours');
    
    const result = await InterviewManager.addInterview(
      'test-user-123', // Test user ID
      'Test Person',
      'Test Interviewer',
      testTime.format('YYYY-MM-DD'),
      testTime.format('HH:mm:ss'),
      'Testing reminder system'
    );
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Test interview created successfully',
        interview: result.data,
        interviewTime: testTime.format('YYYY-MM-DD HH:mm:ss'),
        hoursFromNow: 3
      });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('Test interview creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manual reminder trigger endpoint (for external cron service)
// GET or POST. Use ?action=interview-list to send interview list to everyone instead of 24h/3h reminders.
app.all('/trigger-reminders', async (req, res) => {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
      console.error('trigger-reminders: SUPABASE_URL or SUPABASE_KEY not set');
      return res.status(500).json({
        error: 'Server config error',
        detail: 'SUPABASE_URL or SUPABASE_KEY not configured. Set them in Vercel project Environment Variables.',
        timestamp: new Date().toISOString()
      });
    }

    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    const expectedApiKey = process.env.CRON_API_KEY;
    if (expectedApiKey && apiKey !== expectedApiKey) {
      console.warn('⚠️ Invalid API key provided for reminder trigger');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const action = (req.query.action || '').toLowerCase();

    if (action === 'interview-list') {
      console.log('📋 Sending interview list to everyone...');
      const result = await ReminderManager.sendInterviewListToEveryone();
      if (result.success) {
        return res.json({
          success: true,
          message: 'Interview list sent to everyone',
          sentCount: result.sentCount,
          interviewCount: result.interviewCount,
          errors: result.errors,
          timestamp: new Date().toISOString()
        });
      }
      return res.status(500).json({
        success: false,
        error: result.error,
        sentCount: result.sentCount || 0,
        timestamp: new Date().toISOString()
      });
    }

    console.log('🕐 Processing reminders via serverless endpoint...');
    const result = await ReminderManager.processReminders();
    if (result.success) {
      res.json({
        success: true,
        message: 'Reminders processed successfully',
        totalSent: result.totalSent,
        errors: result.errors,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Error triggering reminders:', error);
    res.status(500).json({
      error: 'Failed to process reminders',
      detail: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Validate president (會長) configuration
if (!PRESIDENT_LINE_USER_ID) {
  console.warn('⚠️ PRESIDENT_LINE_USER_ID not configured - reminders will be sent to interview creator instead');
} else {
  console.log('✅ President (會長) LINE user ID configured for reminders');
}

// Production-ready error handling
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  
  // Log detailed error information for debugging
  if (process.env.NODE_ENV === 'development') {
    console.error('Error stack:', err.stack);
  }
  
  // Don't expose internal errors in production
  const errorMessage = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : err.message;
    
  res.status(500).json({ 
    error: errorMessage,
    timestamp: new Date().toISOString()
  });
});

// Production-ready server startup (skip on Vercel – api/* runs as serverless)
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`🚀 LINE Interview Bot server is running on port ${PORT}`);
    console.log(`📊 Environment: ${NODE_ENV}`);
    console.log(`⏰ Server started at: ${new Date().toISOString()}`);
    console.log(`   - LINE Bot: ${lineConfig.channelAccessToken ? '✅ Configured' : '❌ Missing'}`);
    console.log(`   - Supabase: ${supabaseUrl ? '✅ Configured' : '❌ Missing'}`);
    console.log(`   - President ID: ${PRESIDENT_LINE_USER_ID ? '✅ Configured' : '⚠️ Not set'}`);
  });
}

module.exports = app;
